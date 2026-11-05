import type { RetrievalProvider, RetrievalRequest, RetrievalRunResult } from "@/lib/intelligenceProvider";
import { INTELLIGENCE_SEARCH_LIMITS, normalizeWebResults, planIntelligenceQueries, type WebSearchItem } from "@/lib/intelligenceWebSearch";

interface TavilyCredentials { apiKey?: string; endpoint?: string; fetchImpl?: typeof fetch; }

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/budget exhausted|live_gateway_(?:budget_exceeded|search_call_limit)/i.test(message)) return "budget_exhausted";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/http \d+/i.test(message)) return `upstream_${message.match(/http (\d+)/i)?.[1] ?? "error"}`;
  return "upstream_error";
}

/**
 * A provider-neutral fallback. It deliberately returns the same WebSearchItem
 * contract as Bailian, so the Research Kernel never needs to know its vendor.
 */
export function createTavilyRetrievalProvider(credentials: TavilyCredentials = {}): RetrievalProvider {
  return new TavilyRetrievalProvider(credentials);
}

export class TavilyRetrievalProvider implements RetrievalProvider {
  readonly id = "tavily-web";
  constructor(private readonly credentials: TavilyCredentials = {}) {}

  async searchWeb({ input, queries }: RetrievalRequest): Promise<RetrievalRunResult> {
    const apiKey = this.credentials.apiKey || process.env.TAVILY_API_KEY;
    if (!apiKey) return { status: "failed", results: [], queryCount: 0, errorCode: "missing_credentials", coverageCapability: "unsupported" };
    const planned = queries?.map((query) => query.trim()).filter(Boolean).filter((query, index, list) => list.indexOf(query) === index).slice(0, 4)
      ?? planIntelligenceQueries(input);
    const results: WebSearchItem[] = [];
    const failures: string[] = [];
    for (const query of planned) {
      try {
        results.push(...await this.search(query, apiKey));
      } catch (error) {
        const code = errorCode(error);
        failures.push(code);
        console.warn(`[intelligence-retrieval] provider=tavily-web query failed: ${query}`, code);
      }
    }
    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
    const status: RetrievalRunResult["status"] = unique.length > 0 && failures.length > 0 ? "partial" : unique.length > 0 || failures.length === 0 ? "success" : "failed";
    const error = failures.includes("budget_exhausted") ? "budget_exhausted" : failures.length ? (status === "partial" ? "some_queries_failed" : "all_queries_failed") : undefined;
    return { status, results: unique, queryCount: planned.length, coverageCapability: "unsupported", ...(error ? { errorCode: error } : {}) };
  }

  private async search(query: string, apiKey: string): Promise<WebSearchItem[]> {
    const response = await (this.credentials.fetchImpl ?? fetch)(this.credentials.endpoint || process.env.TAVILY_SEARCH_ENDPOINT || "https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, topic: "news", search_depth: "advanced", max_results: 10, include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    if (!response.ok) {
      if (/LIVE_GATEWAY_(?:BUDGET_EXCEEDED|SEARCH_CALL_LIMIT)/i.test(body)) throw new Error("budget exhausted");
      throw new Error(`Tavily HTTP ${response.status}`);
    }
    const payload = JSON.parse(body) as { results?: unknown[] };
    return normalizeWebResults({ search_results: (payload.results || []).map((row) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return { url: item.url, title: item.title, content: item.content, published_at: item.published_date, source: item.url ? new URL(String(item.url)).hostname : undefined };
    }) }, query);
  }
}
