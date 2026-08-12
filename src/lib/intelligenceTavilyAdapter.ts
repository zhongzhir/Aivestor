import type { RetrievalProvider, RetrievalRequest, RetrievalRunResult } from "@/lib/intelligenceProvider";
import { INTELLIGENCE_SEARCH_LIMITS, normalizeWebResults, planIntelligenceQueries, type WebSearchItem } from "@/lib/intelligenceWebSearch";

interface TavilyCredentials { apiKey?: string; endpoint?: string; }

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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

  async searchWeb({ input, queries, deadlineAt, signal }: RetrievalRequest): Promise<RetrievalRunResult> {
    const apiKey = this.credentials.apiKey || process.env.TAVILY_API_KEY;
    if (!apiKey) return { status: "failed", results: [], queryCount: 0, errorCode: "missing_credentials" };
    const planned = queries?.map((query) => query.trim()).filter(Boolean).filter((query, index, list) => list.indexOf(query) === index).slice(0, 4)
      ?? planIntelligenceQueries(input);
    const results: WebSearchItem[] = [];
    let failed = 0;
    for (const query of planned) {
      try {
        if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new Error("research_total_timeout:web_search");
        results.push(...await this.search(query, apiKey, deadlineAt, signal));
      } catch (error) {
        if (error instanceof Error && error.message.includes("research_total_timeout")) throw error;
        failed++;
        console.warn(`[intelligence-retrieval] provider=tavily-web query failed: ${query}`, errorCode(error));
      }
    }
    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index).slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
    return { status: unique.length > 0 && failed > 0 ? "partial" : unique.length > 0 || failed === 0 ? "success" : "failed", results: unique, queryCount: planned.length, ...(failed === planned.length ? { errorCode: "all_queries_failed" } : {}) };
  }

  private async search(query: string, apiKey: string, deadlineAt?: number, signal?: AbortSignal): Promise<WebSearchItem[]> {
    const controller = new AbortController();
    const remainingMs = deadlineAt === undefined ? 20_000 : Math.min(20_000, deadlineAt - Date.now());
    if (remainingMs <= 0) throw new Error("research_total_timeout:web_search");
    const timer = setTimeout(() => controller.abort(new Error("research_total_timeout:web_search")), remainingMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
    const response = await fetch(this.credentials.endpoint || process.env.TAVILY_SEARCH_ENDPOINT || "https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, topic: "news", search_depth: "advanced", max_results: 10, include_answer: false, include_raw_content: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
    const payload = await response.json() as { results?: unknown[] };
    return normalizeWebResults({ search_results: (payload.results || []).map((row) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return { url: item.url, title: item.title, content: item.content, published_at: item.published_date, source: item.url ? new URL(String(item.url)).hostname : undefined };
    }) }, query);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
