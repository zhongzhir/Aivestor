import type { RetrievalProvider, RetrievalRequest, RetrievalRunResult } from "@/lib/intelligenceProvider";
import { buildIntelligenceSearchRuns, INTELLIGENCE_SEARCH_LIMITS, normalizeWebResults, planIntelligenceQueries, WEB_SEARCH_SYSTEM_PROMPT, type WebSearchItem } from "@/lib/intelligenceWebSearch";

interface BailianCredentials { apiKey?: string; model?: string; }

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/http \d+/i.test(message)) return `upstream_${message.match(/http (\d+)/i)?.[1] ?? "error"}`;
  return "upstream_error";
}

function freshness(input: RetrievalRequest["input"]): number {
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
    if (!apiKey) return { status: "failed", results: [], queryCount: 0, errorCode: "missing_credentials" };
    const planned = queries?.map((query) => query.trim()).filter(Boolean).filter((query, index, list) => list.indexOf(query) === index).slice(0, 8) ?? [];
    const runs = planned.length
      ? planned.map((query) => ({ query, assigned: [], purpose: "general" as const }))
      : buildIntelligenceSearchRuns(input, planIntelligenceQueries(input));
    const results: WebSearchItem[] = [];
    let failed = 0;
    for (const run of runs) {
      try {
        results.push(...await this.searchWithDashScopeHTTP(run.query, freshness(input), run.assigned, apiKey));
      } catch (error) {
        failed++;
        console.warn(`[intelligence-retrieval] provider=bailian-web query failed: ${run.query}`, errorCode(error));
      }
    }
    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
    return { status: unique.length > 0 && failed > 0 ? "partial" : unique.length > 0 || failed === 0 ? "success" : "failed", results: unique, queryCount: runs.length, ...(failed === runs.length ? { errorCode: "all_queries_failed" } : {}) };
  }

  private async searchWithDashScopeHTTP(query: string, freshnessDays: number, assigned: string[], apiKey: string): Promise<WebSearchItem[]> {
    const response = await fetch(process.env.BAILIAN_DASHSCOPE_ENDPOINT || "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.credentials.model || process.env.BAILIAN_SEARCH_MODEL || "qwen-plus",
        input: { messages: [{ role: "system", content: WEB_SEARCH_SYSTEM_PROMPT }, { role: "user", content: `${query}\n只返回与该检索意图直接相关的最新公开信息。` }] },
        parameters: { enable_search: true, result_format: "message", search_options: { forced_search: true, enable_source: true, search_strategy: "turbo", freshness: freshnessDays, ...(assigned.length ? { assigned_site_list: assigned } : {}) } },
      }),
    });
    if (!response.ok) throw new Error(`DashScope HTTP ${response.status}`);
    return normalizeWebResults(await response.json(), query);
  }
}
