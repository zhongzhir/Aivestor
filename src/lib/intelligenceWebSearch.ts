import OpenAI from "openai";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import { TRUSTED_INTELLIGENCE_SOURCES, type IntelligenceSourceDefinition } from "@/lib/intelligenceSources";

export const INTELLIGENCE_SEARCH_LIMITS = { maxQueries: 4, maxCandidates: 80, maxAssignedSites: 8 } as const;

export interface WebSearchCredentials { apiKey: string; baseURL?: string; model?: string; }
export interface WebSearchItem {
  title: string;
  url: string;
  siteName: string;
  snippet: string;
  publishedAt: string | null;
  sourceTier: "A" | "B" | "C" | "D";
  domain: string;
  query: string;
}

function terms(input: IntelligenceTaskInput): string[] {
  return [...input.topics, ...input.entities, ...input.keywords, ...input.regions, ...input.includeRequirements]
    .map((item) => item.trim()).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

export function planIntelligenceQueries(input: IntelligenceTaskInput): string[] {
  const all = terms(input);
  if (!all.length) return [input.name.trim()].filter(Boolean);
  const subject = [...input.topics, ...input.entities].filter(Boolean).join(" ");
  const qualifiers = [...input.keywords, ...input.includeRequirements].filter(Boolean).join(" ");
  const queries = [subject || all.join(" "), `${subject || all.join(" ")} ${qualifiers}`.trim(), `${all.join(" ")} 最新动态`, `${all.join(" ")} 融资 并购 政策 产品 合作`];
  return queries.map((query) => query.trim()).filter(Boolean).filter((query, index, list) => list.indexOf(query) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxQueries);
}

function freshness(input: IntelligenceTaskInput): number { return input.lookbackPeriod.kind === "days" && (input.lookbackPeriod.value ?? 3) <= 1 ? 7 : input.lookbackPeriod.kind === "days" && (input.lookbackPeriod.value ?? 3) <= 7 ? 30 : 365; }
function domainOf(value: string): string { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; } }
function normalizeUrl(value: string): string | null { try { const url = new URL(value); if (url.protocol !== "http:" && url.protocol !== "https:") return null; ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid"].forEach((key) => url.searchParams.delete(key)); url.hash = ""; return url.toString().replace(/\/$/, ""); } catch { return null; } }
function tierFor(domain: string): "A" | "B" | "C" | "D" { if (!domain) return "D"; const source = TRUSTED_INTELLIGENCE_SOURCES.find((item) => domainOf(item.homepage) === domain); if (source) return source.trustLevel === "official" || source.trustLevel === "regulatory" ? "A" : "B"; return "C"; }
function matchingSources(input: IntelligenceTaskInput): string[] { const haystack = terms(input).join(" ").toLocaleLowerCase(); return TRUSTED_INTELLIGENCE_SOURCES.filter((source) => source.aliases.some((alias) => haystack.includes(alias.toLocaleLowerCase()))).map((source) => domainOf(source.homepage)).filter(Boolean).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxAssignedSites); }

function extractSearchResults(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.search_results)) return object.search_results;
  for (const child of Object.values(object)) { const found = extractSearchResults(child); if (found.length) return found; }
  return [];
}

export function normalizeWebResults(raw: unknown, query: string): WebSearchItem[] {
  return extractSearchResults(raw).map((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const url = normalizeUrl(String(row.url ?? row.link ?? ""));
    const title = String(row.title ?? "").trim();
    if (!url || !title) return null;
    const domain = domainOf(url);
    return { title, url, siteName: String(row.site_name ?? row.siteName ?? row.source ?? domain).trim() || domain, snippet: String(row.snippet ?? row.content ?? row.description ?? "").trim().slice(0, 4000), publishedAt: row.published_at || row.publishedAt || row.date ? String(row.published_at ?? row.publishedAt ?? row.date) : null, sourceTier: tierFor(domain), domain, query };
  }).filter((item): item is WebSearchItem => !!item).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
}

export async function searchWebForIntelligence(input: IntelligenceTaskInput, start: Date, credentials?: WebSearchCredentials): Promise<WebSearchItem[]> {
  const apiKey = credentials?.apiKey || process.env.BAILIAN_API_KEY;
  if (!apiKey) return [];
  const client = new OpenAI({ apiKey, baseURL: credentials?.baseURL || process.env.BAILIAN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1" });
  const assigned = matchingSources(input);
  const results: WebSearchItem[] = [];
  for (const query of planIntelligenceQueries(input)) {
    try {
      const response = await client.chat.completions.create({
        model: credentials?.model || process.env.BAILIAN_SEARCH_MODEL || "qwen-plus",
        messages: [{ role: "system", content: "你是联网检索器。必须进行实时联网搜索，返回可核验的原始网页结果；不要只给自然语言总结。" }, { role: "user", content: `${query}\n只返回与该检索意图直接相关的最新公开信息。` }],
        enable_search: true,
        enable_source: true,
        search_options: { forced_search: true, search_strategy: "turbo", freshness: freshness(input), ...(assigned.length ? { assigned_site_list: assigned } : {}) },
      } as any);
      let normalized = normalizeWebResults(response, query);
      // 百炼 OpenAI 兼容 Chat 接口的部分返回只包含自然语言答案，不暴露 search_results。
      // 此时使用同一 BAILIAN_API_KEY 调用 DashScope 原生 HTTP 接口，取得结构化来源。
      if (!normalized.length) normalized = await searchWithDashScopeHTTP(query, freshness(input), assigned, apiKey);
      results.push(...normalized);
    } catch (error) {
      console.warn(`[intelligence-web-search] query failed: ${query}`, error instanceof Error ? error.message : error);
    }
  }
  return results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
}

async function searchWithDashScopeHTTP(query: string, freshnessDays: number, assigned: string[], apiKey: string): Promise<WebSearchItem[]> {
  const response = await fetch(process.env.BAILIAN_DASHSCOPE_ENDPOINT || "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.BAILIAN_SEARCH_MODEL || "qwen-plus",
      input: { messages: [{ role: "user", content: `${query}\n必须进行联网搜索，并返回可核验的原始网页来源。` }] },
      parameters: { enable_search: true, result_format: "message", search_options: { forced_search: true, enable_source: true, search_strategy: "turbo", freshness: freshnessDays, ...(assigned.length ? { assigned_site_list: assigned } : {}) } },
    }),
  });
  if (!response.ok) throw new Error(`DashScope HTTP ${response.status}`);
  return normalizeWebResults(await response.json(), query);
}
