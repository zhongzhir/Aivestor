import {
  EVIDENCE_LIMITS,
  acquireEvidence,
  fetchPublicEvidence,
  validatePublicHttpUrl,
  type EvidenceAcquirer,
  type EvidenceFetcher,
  type EvidenceResult,
} from "@/lib/intelligenceEvidence";
import type { RetrievalProvider, RetrievalRequest, RetrievalRunResult } from "@/lib/intelligenceProvider";
import { INTELLIGENCE_SEARCH_LIMITS, normalizeWebResults, planIntelligenceQueries, type WebSearchItem } from "@/lib/intelligenceWebSearch";

const OFFICIAL_BASE_URL = "https://api.deepseek.com";
const SEARCH_PATH = "/v1/tools/search";
const FETCH_PATH = "/v1/tools/fetch";
const REQUEST_USD_MICROS = 750; // USD 0.75 / 1,000 successful requests.

export type DeepSeekCallKind = "search" | "fetch";
type AttemptStatus = "pending" | "completed" | "failed" | "uncertain";

interface AttemptRecord {
  id: number;
  kind: DeepSeekCallKind;
  status: AttemptStatus;
  billable: boolean;
}

export interface DeepSeekBudgetSnapshot {
  searchAttempts: number;
  fetchAttempts: number;
  searchReserved: number;
  searchCompleted: number;
  searchFailed: number;
  searchUncertain: number;
  fetchReserved: number;
  fetchCompleted: number;
  fetchFailed: number;
  fetchUncertain: number;
  billableSearch: number;
  billableFetch: number;
  uncertain: number;
  /** 保守上界：每个已发请求均按一次成功请求计价。 */
  reservedUsdMicros: number;
  /** 仅根据已确认非空 200 响应计算；不等同于账单。 */
  estimatedBillableUsdMicros: number;
}

export interface DeepSeekDurableAttemptLedger {
  reserve(kind: DeepSeekCallKind, reservedUsdMicros: number): Promise<string>;
  complete(id: string, billable: boolean, estimatedBillableUsdMicros: number): Promise<void>;
  fail(id: string): Promise<void>;
  uncertain(id: string): Promise<void>;
}

export class DeepSeekSearchFetchBudget {
  private sequence = 0;
  private records: AttemptRecord[] = [];

  constructor(
    private readonly maxSearchRequests = 8,
    private readonly maxFetchRequests = 8,
    private readonly maxReservedUsdMicros = (maxSearchRequests + maxFetchRequests) * REQUEST_USD_MICROS,
  ) {}

  reserve(kind: DeepSeekCallKind): number {
    const kindCount = this.records.filter((record) => record.kind === kind).length;
    const kindLimit = kind === "search" ? this.maxSearchRequests : this.maxFetchRequests;
    if (kindCount >= kindLimit) throw new Error(`DEEPSEEK_${kind.toUpperCase()}_BUDGET_EXHAUSTED`);
    if ((this.records.length + 1) * REQUEST_USD_MICROS > this.maxReservedUsdMicros) throw new Error("DEEPSEEK_TOTAL_BUDGET_EXHAUSTED");
    const id = ++this.sequence;
    this.records.push({ id, kind, status: "pending", billable: false });
    return id;
  }

  complete(id: number, billable: boolean): void {
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== "pending") throw new Error("DEEPSEEK_BUDGET_RECORD_INVALID");
    record.status = "completed";
    record.billable = billable;
  }

  fail(id: number): void {
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== "pending") throw new Error("DEEPSEEK_BUDGET_RECORD_INVALID");
    record.status = "failed";
  }

  uncertain(id: number): void {
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== "pending") throw new Error("DEEPSEEK_BUDGET_RECORD_INVALID");
    record.status = "uncertain";
  }

  snapshot(): DeepSeekBudgetSnapshot {
    const search = this.records.filter((record) => record.kind === "search");
    const fetch = this.records.filter((record) => record.kind === "fetch");
    const billableSearch = search.filter((record) => record.billable).length;
    const billableFetch = fetch.filter((record) => record.billable).length;
    return {
      searchAttempts: search.length,
      fetchAttempts: fetch.length,
      searchReserved: search.filter((record) => record.status === "pending").length,
      searchCompleted: search.filter((record) => record.status === "completed").length,
      searchFailed: search.filter((record) => record.status === "failed").length,
      searchUncertain: search.filter((record) => record.status === "uncertain").length,
      fetchReserved: fetch.filter((record) => record.status === "pending").length,
      fetchCompleted: fetch.filter((record) => record.status === "completed").length,
      fetchFailed: fetch.filter((record) => record.status === "failed").length,
      fetchUncertain: fetch.filter((record) => record.status === "uncertain").length,
      billableSearch,
      billableFetch,
      uncertain: this.records.filter((record) => record.status === "uncertain").length,
      reservedUsdMicros: this.records.length * REQUEST_USD_MICROS,
      estimatedBillableUsdMicros: (billableSearch + billableFetch) * REQUEST_USD_MICROS,
    };
  }
}

type SafeUrlValidator = (value: string) => Promise<URL>;

export interface DeepSeekSearchFetchCredentials {
  apiKey?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
  validateUrl?: SafeUrlValidator;
  timeoutMs?: number;
  maxAttempts?: number;
  concurrency?: number;
  resultCount?: number;
  budget?: DeepSeekSearchFetchBudget;
  durableAttemptLedger?: DeepSeekDurableAttemptLedger;
  sleep?: (ms: number) => Promise<void>;
}

interface SearchRow {
  rerank_score?: unknown;
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
  content?: unknown;
  site_name?: unknown;
  date?: unknown;
  authority?: unknown;
}

function officialRoot(baseURL?: string): string {
  const parsed = new URL(baseURL || OFFICIAL_BASE_URL);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function isOfficialDeepSeekBaseUrl(baseURL?: string): boolean {
  try {
    const parsed = new URL(baseURL || OFFICIAL_BASE_URL);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.protocol === "https:"
      && parsed.hostname.toLocaleLowerCase() === "api.deepseek.com"
      && (!parsed.port || parsed.port === "443")
      && !parsed.username
      && !parsed.password
      && (path === "/" || path === "/v1");
  } catch {
    return false;
  }
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}

/** DeepSeek after/before are strict; pad one day and post-filter known dates. */
export function deepSeekHistoricalQuery(query: string, start: Date, end?: Date): string {
  const clean = query.replace(/\b(?:after|before):\d{4}(?:-\d{2}-\d{2})?\b/giu, "").replace(/\s+/g, " ").trim();
  const suffix = [`after:${utcDay(addUtcDays(start, -1))}`, ...(end ? [`before:${utcDay(addUtcDays(end, 1))}`] : [])].join(" ");
  const available = Math.max(1, 128 - [...suffix].length - 1);
  return `${[...clean].slice(0, available).join("")} ${suffix}`.trim();
}

function inRequestedWindow(value: string | null, start: Date, end?: Date): boolean {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return timestamp >= start.getTime() && (!end || timestamp <= end.getTime());
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/BUDGET_EXHAUSTED/i.test(message)) return "budget_exhausted";
  if (/request_uncertain/i.test(message)) return "request_uncertain";
  if (/timeout|abort/i.test(message)) return "timeout";
  if (/HTTP \d+/i.test(message)) return `upstream_${message.match(/HTTP (\d+)/i)?.[1] ?? "error"}`;
  if (/invalid_response/i.test(message)) return "invalid_response";
  return "upstream_error";
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function cleanMarkdown(value: unknown): string {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, EVIDENCE_LIMITS.maxTextChars);
}

export class DeepSeekSearchFetchAdapter implements RetrievalProvider {
  readonly id = "deepseek-web";
  readonly budget: DeepSeekSearchFetchBudget;
  private readonly fetchImpl: typeof fetch;
  private readonly searchEndpoint: string;
  private readonly fetchEndpoint: string;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly resultCount: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly validateUrl: SafeUrlValidator;

  constructor(private readonly credentials: DeepSeekSearchFetchCredentials = {}) {
    if (!isOfficialDeepSeekBaseUrl(credentials.baseURL)) {
      throw new Error("DeepSeek Search/Fetch requires the official API endpoint");
    }
    const root = officialRoot(credentials.baseURL);
    this.searchEndpoint = `${root}${SEARCH_PATH}`;
    this.fetchEndpoint = `${root}${FETCH_PATH}`;
    this.fetchImpl = credentials.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, Math.min(2, credentials.maxAttempts ?? 2));
    this.concurrency = Math.max(1, Math.min(3, credentials.concurrency ?? 2));
    this.resultCount = Math.max(1, Math.min(50, credentials.resultCount ?? 10));
    this.timeoutMs = Math.max(1_000, Math.min(30_000, credentials.timeoutMs ?? 15_000));
    this.budget = credentials.budget ?? new DeepSeekSearchFetchBudget();
    this.sleep = credentials.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.validateUrl = credentials.validateUrl ?? (async (value) => (await validatePublicHttpUrl(value)).url);
  }

  usageSnapshot(): DeepSeekBudgetSnapshot {
    return this.budget.snapshot();
  }

  private apiKey(): string | undefined {
    return this.credentials.apiKey || process.env.DEEPSEEK_API_KEY || process.env.SYSTEM_DEEPSEEK_API_KEY;
  }

  private async requestJson<T>(kind: DeepSeekCallKind, endpoint: string, body: Record<string, unknown>, parse: (value: unknown) => { value: T; billable: boolean }): Promise<T> {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error("DeepSeek missing credentials");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const reservation = this.budget.reserve(kind);
      let durableReservation: string | undefined;
      try {
        durableReservation = await this.credentials.durableAttemptLedger?.reserve(kind, REQUEST_USD_MICROS);
      } catch (error) {
        this.budget.fail(reservation);
        throw new Error(`DeepSeek ${kind} durable_audit_unavailable`, { cause: error });
      }
      let response: Response;
      try {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        this.budget.uncertain(reservation);
        if (durableReservation) await this.credentials.durableAttemptLedger?.uncertain(durableReservation);
        throw new Error(`DeepSeek ${kind} request_uncertain`, { cause: error });
      }
      let raw: string;
      try {
        raw = await response.text();
      } catch (error) {
        this.budget.uncertain(reservation);
        if (durableReservation) await this.credentials.durableAttemptLedger?.uncertain(durableReservation);
        throw new Error(`DeepSeek ${kind} request_uncertain`, { cause: error });
      }
      if (!response.ok) {
        this.budget.fail(reservation);
        if (durableReservation) await this.credentials.durableAttemptLedger?.fail(durableReservation);
        if (retryableStatus(response.status) && attempt < this.maxAttempts) {
          await this.sleep(Math.min(500, 100 * attempt));
          continue;
        }
        throw new Error(`DeepSeek ${kind} HTTP ${response.status}`);
      }
      let parsed: { value: T; billable: boolean };
      try {
        parsed = parse(JSON.parse(raw));
      } catch (error) {
        // A malformed HTTP 200 may still have been billed. Fail closed and do
        // not retry, avoiding a second potentially billable request.
        this.budget.complete(reservation, true);
        if (durableReservation) await this.credentials.durableAttemptLedger?.complete(durableReservation, true, REQUEST_USD_MICROS);
        throw new Error(`DeepSeek ${kind} invalid_response`, { cause: error });
      }
      this.budget.complete(reservation, parsed.billable);
      if (durableReservation) await this.credentials.durableAttemptLedger?.complete(
        durableReservation,
        parsed.billable,
        parsed.billable ? REQUEST_USD_MICROS : 0,
      );
      return parsed.value;
    }
    throw new Error(`DeepSeek ${kind} retry_exhausted`);
  }

  private async searchOne(query: string, request: RetrievalRequest): Promise<WebSearchItem[]> {
    const ranged = deepSeekHistoricalQuery(query, request.start, request.end);
    const rows = await this.requestJson<SearchRow[]>("search", this.searchEndpoint, {
      query: ranged,
      count: this.resultCount,
      need_content: false,
    }, (value) => {
      const results = value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)
        ? (value as { results: SearchRow[] }).results
        : null;
      if (!results) throw new Error("search results missing");
      return { value: results, billable: results.length > 0 };
    });
    return normalizeWebResults({
      search_results: rows.map((row) => ({
        title: row.title,
        url: row.url,
        snippet: String(row.summary ?? row.snippet ?? ""),
        site_name: row.site_name,
        published_at: row.date,
      })),
    }, query).filter((item) => inRequestedWindow(item.publishedAt, request.start, request.end));
  }

  async searchWeb(request: RetrievalRequest): Promise<RetrievalRunResult> {
    if (!this.apiKey()) return { status: "failed", results: [], queryCount: 0, errorCode: "missing_credentials", coverageCapability: "coarse" };
    const planned = (request.queries?.length ? request.queries : planIntelligenceQueries(request.input))
      .map((query) => query.trim()).filter(Boolean)
      .filter((query, index, list) => list.indexOf(query) === index)
      .slice(0, INTELLIGENCE_SEARCH_LIMITS.maxQueries);
    const batches: WebSearchItem[][] = Array.from({ length: planned.length }, () => []);
    const failures: string[] = [];
    let batchPersistenceError: unknown;
    let cursor = 0;
    const worker = async () => {
      while (cursor < planned.length && !batchPersistenceError) {
        const index = cursor++;
        let results: WebSearchItem[];
        try {
          results = await this.searchOne(planned[index]!, request);
        } catch (error) {
          failures.push(failureCode(error));
          continue;
        }
        batches[index] = results;
        // The paid request is already complete. Persist its candidates before
        // another research stage can fail; a checkpoint failure must stop the
        // pipeline rather than silently issuing more work.
        try {
          await request.onBatch?.({ provider: this.id, query: planned[index]!, results });
        } catch (error) {
          // Do not let Promise.all reject while another paid request is still
          // completing. Stop assigning new queries, await every in-flight
          // branch, then surface the first persistence error to the worker.
          batchPersistenceError ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, planned.length)) }, worker));
    if (batchPersistenceError) throw batchPersistenceError;
    const results = batches.flat().filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
      .slice(0, INTELLIGENCE_SEARCH_LIMITS.maxCandidates);
    const succeededQueries = planned.length - failures.length;
    const status: RetrievalRunResult["status"] = succeededQueries === 0 ? "failed" : failures.length ? "partial" : "success";
    const distinctFailures = [...new Set(failures)];
    const errorCode = failures.includes("budget_exhausted") ? "budget_exhausted"
      : failures.includes("request_uncertain") ? "request_uncertain"
        : distinctFailures.length === 1 ? distinctFailures[0]
          : failures.length ? (status === "partial" ? "some_queries_failed" : "all_queries_failed") : undefined;
    return {
      status,
      results,
      queryCount: planned.length,
      coverageCapability: "coarse",
      batchesPersisted: !!request.onBatch,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  async fetchEvidence(value: string): Promise<EvidenceResult> {
    let url: URL;
    try {
      url = await this.validateUrl(value);
    } catch (error) {
      return { url: value, finalUrl: value, text: "", evidenceStatus: "unavailable", failureReason: error instanceof Error ? error.message : "invalid_url" };
    }
    try {
      const page = await this.requestJson<{ title: string; content: string }>("fetch", this.fetchEndpoint, { url: url.toString() }, (payload) => {
        if (!payload || typeof payload !== "object") throw new Error("fetch response missing");
        const title = String((payload as { title?: unknown }).title ?? "").trim();
        const content = cleanMarkdown((payload as { content?: unknown }).content);
        return { value: { title, content }, billable: content.length > 0 };
      });
      const evidenceStatus = page.content.length >= 500 ? "full" : page.content.length >= 120 ? "partial" : "unavailable";
      return {
        url: value,
        finalUrl: url.toString(),
        ...(page.title ? { title: page.title } : {}),
        text: page.content,
        evidenceStatus,
        ...(evidenceStatus === "unavailable" ? { failureReason: "insufficient_text" } : {}),
      };
    } catch (error) {
      return { url: value, finalUrl: url.toString(), text: "", evidenceStatus: "unavailable", failureReason: failureCode(error) };
    }
  }
}

export function createDeepSeekSearchFetchAdapter(credentials: DeepSeekSearchFetchCredentials = {}): DeepSeekSearchFetchAdapter {
  return new DeepSeekSearchFetchAdapter(credentials);
}

export type DeepSeekFetchMode = "off" | "fallback" | "prefer";

export function createDeepSeekEvidenceAcquirer(
  provider: Pick<DeepSeekSearchFetchAdapter, "fetchEvidence">,
  options: { mode: Exclude<DeepSeekFetchMode, "off">; localFetcher?: EvidenceFetcher },
): EvidenceAcquirer {
  const local = options.localFetcher ?? fetchPublicEvidence;
  return async (candidates, acquireOptions = {}) => acquireEvidence(candidates, {
    ...acquireOptions,
    fetchEvidence: async (url) => {
      const first = options.mode === "prefer" ? await provider.fetchEvidence(url) : await local(url);
      if (first.evidenceStatus !== "unavailable") return first;
      return options.mode === "prefer" ? local(url) : provider.fetchEvidence(url);
    },
  });
}
