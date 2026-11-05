import type { RetrievalProvider, RetrievalRequest, RetrievalRunResult } from "@/lib/intelligenceProvider";
import { buildIntelligenceSearchRuns, INTELLIGENCE_SEARCH_LIMITS, normalizeWebResults, planIntelligenceQueries, WEB_SEARCH_SYSTEM_PROMPT, type WebSearchItem } from "@/lib/intelligenceWebSearch";

interface BailianCredentials { apiKey?: string; model?: string; endpoint?: string; fetchImpl?: typeof fetch; }

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/budget exhausted|live_gateway_(?:budget_exceeded|search_call_limit)/i.test(message)) return "budget_exhausted";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/http \d+/i.test(message)) return `upstream_${message.match(/http (\d+)/i)?.[1] ?? "error"}`;
  return "upstream_error";
}

export function bailianFreshness(input: RetrievalRequest["input"], now = Date.now()): number | null {
  if (input.lookbackPeriod.kind === "custom" && input.lookbackPeriod.start) {
    const start = new Date(input.lookbackPeriod.start);
    const end = input.lookbackPeriod.end ? new Date(input.lookbackPeriod.end) : new Date(now);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || end.getTime() > now) return null;
    const spanDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
    const freshness = spanDays <= 7 ? 30 : 365;
    // DashScope freshness is relative to the call time, not to requestedEnd.
    // It is safe only when that relative window covers the *entire* requested
    // interval. Otherwise it silently cuts off the early part of a historical
    // or long-running custom range.
    return start.getTime() >= now - freshness * 86400000 ? freshness : null;
  }
  return input.lookbackPeriod.kind === "days" && (input.lookbackPeriod.value ?? 3) <= 1 ? 7 : input.lookbackPeriod.kind === "days" && (input.lookbackPeriod.value ?? 3) <= 7 ? 30 : 365;
}

export function createBailianRetrievalProvider(credentials: BailianCredentials = {}): RetrievalProvider {
  return new BailianRetrievalProvider(credentials);
}

export class BailianRetrievalProvider implements RetrievalProvider {
  readonly id = "bailian-web";
  constructor(private readonly credentials: BailianCredentials = {}) {}

  async searchWeb({ input, queries }: RetrievalRequest): Promise<RetrievalRunResult> {
    const apiKey = this.credentials.apiKey || process.env.BAILIAN_API_KEY;
    if (!apiKey) return { status: "failed", results: [], queryCount: 0, errorCode: "missing_credentials", coverageCapability: "coarse" };
    const planned = queries?.map((query) => query.trim()).filter(Boolean).filter((query, index, list) => list.indexOf(query) === index).slice(0, 8) ?? [];
    const runs = planned.length
      ? planned.map((query) => ({ query, assigned: [], purpose: "general" as const }))
      : buildIntelligenceSearchRuns(input, planIntelligenceQueries(input));
    const results: WebSearchItem[] = [];
    const failures: string[] = [];
    for (const run of runs) {
      try {
        results.push(...await this.searchWithDashScopeHTTP(run.query, bailianFreshness(input), run.assigned, apiKey));
      } catch (error) {
        const code = errorCode(error);
        failures.push(code);
        console.warn(`[intelligence-retrieval] provider=bailian-web query failed: ${run.query}`, code);
      }
    }
    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
    const status: RetrievalRunResult["status"] = unique.length > 0 && failures.length > 0 ? "partial" : unique.length > 0 || failures.length === 0 ? "success" : "failed";
    const error = failures.includes("budget_exhausted") ? "budget_exhausted" : failures.length ? (status === "partial" ? "some_queries_failed" : "all_queries_failed") : undefined;
    return { status, results: unique, queryCount: runs.length, coverageCapability: "coarse", ...(error ? { errorCode: error } : {}) };
  }

  private async searchWithDashScopeHTTP(query: string, freshnessDays: number | null, assigned: string[], apiKey: string): Promise<WebSearchItem[]> {
    const response = await (this.credentials.fetchImpl ?? fetch)(this.credentials.endpoint || process.env.BAILIAN_DASHSCOPE_ENDPOINT || "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.credentials.model || process.env.BAILIAN_SEARCH_MODEL || "qwen-plus",
        input: { messages: [{ role: "system", content: WEB_SEARCH_SYSTEM_PROMPT }, { role: "user", content: `${query}\n只返回与该检索意图直接相关、且符合问题中明确时间范围的公开信息；不要用当前最新资讯替代历史窗口。` }] },
        parameters: { enable_search: true, result_format: "message", search_options: { forced_search: true, enable_source: true, search_strategy: "turbo", ...(freshnessDays === null ? {} : { freshness: freshnessDays }), ...(assigned.length ? { assigned_site_list: assigned } : {}) } },
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      if (/LIVE_GATEWAY_(?:BUDGET_EXCEEDED|SEARCH_CALL_LIMIT)/i.test(body)) throw new Error("budget exhausted");
      throw new Error(`DashScope HTTP ${response.status}`);
    }
    return normalizeWebResults(JSON.parse(body), query);
  }
}
