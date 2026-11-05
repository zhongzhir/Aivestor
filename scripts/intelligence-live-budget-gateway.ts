import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const LIVE_MODEL = "qwen-plus-2025-07-14";
export const LIVE_BUDGET_LIMIT_MICROS = 5_000_000;
export const LIVE_GENERATION_CALL_LIMIT = 24;
// The original CNY 5 validation session consumed 20 search calls. The owner
// explicitly authorized exactly two additional calls for the fixed
// Bailian/DeepSeek comparison on 2026-11-04. Keep the monetary cap unchanged.
export const LIVE_SEARCH_CALL_LIMIT = 22;
export const LIVE_GENERATION_MAX_OUTPUT_TOKENS = 4_096;
export const LIVE_SEARCH_MAX_OUTPUT_TOKENS = 2_048;

const MODEL_MAX_INPUT_TOKENS = 98_304;
const OUTPUT_TOKEN_SAFETY_ALLOWANCE = 32;
const PROTOCOL_TOKEN_ALLOWANCE = 4_096;
const INPUT_MICROS_PER_MILLION = 800_000;
// Use the higher thinking-mode output price even though the gateway disables thinking.
const OUTPUT_MICROS_PER_MILLION = 8_000_000;
// turbo currently lists CNY 3/1000 calls. Reserve CNY 4/1000 conservatively.
const SEARCH_FIXED_MICROS = 4_000;
const OFFICIAL_GENERATION_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const OFFICIAL_SEARCH_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

type CallKind = "generation" | "search";
type RecordStatus = "pending" | "completed" | "uncertain";

interface CachedResponse {
  status: number;
  contentType: string;
  bodyBase64: string;
}

export interface BudgetLedgerRecord {
  id: string;
  fingerprint: string;
  kind: CallKind;
  status: RecordStatus;
  reservedMicros: number;
  inputTokenUpperBound: number;
  maxOutputTokens: number;
  createdAt: string;
  updatedAt: string;
  upstreamAttempts: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  cachedResponse?: CachedResponse;
  errorCode?: string;
}

export interface BudgetLedgerState {
  version: 1;
  sessionId: string;
  currency: "CNY";
  limitMicros: number;
  model: typeof LIVE_MODEL;
  generationCallLimit: number;
  searchCallLimit: number;
  createdAt: string;
  updatedAt: string;
  records: BudgetLedgerRecord[];
}

export interface GatewayOptions {
  host?: string;
  port?: number;
  ledgerPath: string;
  upstreamApiKey: string;
  resume?: boolean;
  limitMicros?: number;
  generationCallLimit?: number;
  searchCallLimit?: number;
  generationEndpoint?: string;
  searchEndpoint?: string;
  allowTestUpstream?: boolean;
  /**
   * Separates a deliberately approved retry from prior cached responses while
   * keeping every attempt in the same cumulative ledger and call limits.
   * Never derive this value from a credential.
   */
  fingerprintScope?: string;
}

export interface GatewayHandle {
  server: Server;
  baseUrl: string;
  ledger: LiveBudgetLedger;
  close(): Promise<void>;
}

function ceilTokenCost(tokens: number, microsPerMillion: number): number {
  return Math.ceil((tokens * microsPerMillion) / 1_000_000);
}

function tokenUpperBoundFromPayload(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  if (!serialized) throw new Error("LIVE_GATEWAY_UNSERIALIZABLE_PAYLOAD");
  return Buffer.byteLength(serialized, "utf8") + PROTOCOL_TOKEN_ALLOWANCE;
}

function quote(kind: CallKind, payload: unknown): Pick<BudgetLedgerRecord, "reservedMicros" | "inputTokenUpperBound" | "maxOutputTokens"> {
  const maxOutputTokens = kind === "generation" ? LIVE_GENERATION_MAX_OUTPUT_TOKENS : LIVE_SEARCH_MAX_OUTPUT_TOKENS;
  // Search injects provider-selected web text that is absent from the submitted payload.
  // Reserve the snapshot model's entire documented input capacity for every search call.
  const inputTokenUpperBound = kind === "search" ? MODEL_MAX_INPUT_TOKENS : tokenUpperBoundFromPayload(payload);
  if (inputTokenUpperBound > MODEL_MAX_INPUT_TOKENS) throw new Error("LIVE_GATEWAY_INPUT_LIMIT_EXCEEDED");
  const reservedMicros = ceilTokenCost(inputTokenUpperBound, INPUT_MICROS_PER_MILLION)
    + ceilTokenCost(maxOutputTokens + OUTPUT_TOKEN_SAFETY_ALLOWANCE, OUTPUT_MICROS_PER_MILLION)
    + (kind === "search" ? SEARCH_FIXED_MICROS : 0);
  return { reservedMicros, inputTokenUpperBound, maxOutputTokens };
}

function fingerprint(kind: CallKind, payload: unknown, scope = ""): string {
  return createHash("sha256").update(`${scope}\n${kind}\n${JSON.stringify(payload)}`).digest("hex");
}

function isLoopbackEndpoint(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function checkedEndpoint(value: string, official: string, allowTestUpstream: boolean): string {
  if (value === official) return value;
  if (allowTestUpstream && isLoopbackEndpoint(value)) return value;
  throw new Error("LIVE_GATEWAY_UNAPPROVED_UPSTREAM");
}

function sanitizeGenerationPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("LIVE_GATEWAY_INVALID_GENERATION_PAYLOAD");
  const payload = { ...(raw as Record<string, unknown>) };
  if (payload.model !== LIVE_MODEL) throw new Error("LIVE_GATEWAY_MODEL_MISMATCH");
  payload.max_tokens = LIVE_GENERATION_MAX_OUTPUT_TOKENS;
  payload.enable_thinking = false;
  payload.n = 1;
  if (payload.stream === true) {
    const streamOptions = payload.stream_options && typeof payload.stream_options === "object" && !Array.isArray(payload.stream_options)
      ? payload.stream_options as Record<string, unknown>
      : {};
    payload.stream_options = { ...streamOptions, include_usage: true };
  }
  return payload;
}

function sanitizeSearchPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("LIVE_GATEWAY_INVALID_SEARCH_PAYLOAD");
  const payload = { ...(raw as Record<string, unknown>) };
  if (payload.model !== LIVE_MODEL) throw new Error("LIVE_GATEWAY_MODEL_MISMATCH");
  const parameters = payload.parameters && typeof payload.parameters === "object" && !Array.isArray(payload.parameters)
    ? { ...(payload.parameters as Record<string, unknown>) }
    : {};
  const searchOptions = parameters.search_options && typeof parameters.search_options === "object" && !Array.isArray(parameters.search_options)
    ? { ...(parameters.search_options as Record<string, unknown>) }
    : {};
  parameters.max_tokens = LIVE_SEARCH_MAX_OUTPUT_TOKENS;
  parameters.enable_thinking = false;
  parameters.enable_search = true;
  parameters.result_format = "message";
  parameters.search_options = { ...searchOptions, forced_search: true, enable_source: true, search_strategy: "turbo" };
  payload.parameters = parameters;
  return payload;
}

function usageFromResponse(kind: CallKind, contentType: string, body: Buffer): { inputTokens?: number; outputTokens?: number } {
  const text = body.toString("utf8");
  const objects: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:") || line.trim() === "data: [DONE]") continue;
      try { objects.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore non-JSON event */ }
    }
  } else {
    try { objects.push(JSON.parse(text)); } catch { return {}; }
  }
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const value of objects) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const usage = row.usage && typeof row.usage === "object" && !Array.isArray(row.usage) ? row.usage as Record<string, unknown> : null;
    if (!usage) continue;
    const input = kind === "generation" ? usage.prompt_tokens : usage.input_tokens;
    const output = kind === "generation" ? usage.completion_tokens : usage.output_tokens;
    if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) inputTokens = input;
    if (typeof output === "number" && Number.isSafeInteger(output) && output >= 0) outputTokens = output;
  }
  return { inputTokens, outputTokens };
}

export class LiveBudgetLedger {
  private state!: BudgetLedgerState;
  private mutex: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string) {}

  static async open(path: string, options: Pick<GatewayOptions, "resume" | "limitMicros" | "generationCallLimit" | "searchCallLimit"> = {}): Promise<LiveBudgetLedger> {
    const ledger = new LiveBudgetLedger(path);
    const requestedLimit = options.limitMicros ?? LIVE_BUDGET_LIMIT_MICROS;
    const requestedGenerationLimit = options.generationCallLimit ?? LIVE_GENERATION_CALL_LIMIT;
    const requestedSearchLimit = options.searchCallLimit ?? LIVE_SEARCH_CALL_LIMIT;
    if (requestedLimit > LIVE_BUDGET_LIMIT_MICROS || requestedGenerationLimit > LIVE_GENERATION_CALL_LIMIT || requestedSearchLimit > LIVE_SEARCH_CALL_LIMIT) {
      throw new Error("LIVE_GATEWAY_LIMIT_EXCEEDS_AUTHORIZATION");
    }
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as BudgetLedgerState;
      if (!options.resume) throw new Error("LIVE_GATEWAY_LEDGER_EXISTS");
      if (parsed.version !== 1 || parsed.currency !== "CNY" || parsed.model !== LIVE_MODEL) throw new Error("LIVE_GATEWAY_LEDGER_INCOMPATIBLE");
      if (requestedLimit < parsed.limitMicros) throw new Error("LIVE_GATEWAY_BUDGET_LIMIT_DECREASE_FORBIDDEN");
      if (requestedGenerationLimit < parsed.generationCallLimit || requestedSearchLimit < parsed.searchCallLimit) {
        throw new Error("LIVE_GATEWAY_CALL_LIMIT_DECREASE_FORBIDDEN");
      }
      const committed = parsed.records.reduce((sum, record) => sum + record.reservedMicros, 0);
      if (committed > requestedLimit) throw new Error("LIVE_GATEWAY_LEDGER_OVER_BUDGET");
      const now = new Date().toISOString();
      parsed.records = parsed.records.map((record) => record.status === "pending"
        ? { ...record, status: "uncertain" as const, updatedAt: now, errorCode: "gateway_restarted_during_call" }
        : record);
      parsed.updatedAt = now;
      parsed.limitMicros = requestedLimit;
      parsed.generationCallLimit = requestedGenerationLimit;
      parsed.searchCallLimit = requestedSearchLimit;
      ledger.state = parsed;
      await ledger.persist();
      return ledger;
    } catch (error) {
      if (error instanceof Error && error.message !== "ENOENT" && !/ENOENT/.test(error.message)) throw error;
    }
    const now = new Date().toISOString();
    ledger.state = {
      version: 1,
      sessionId: randomUUID(),
      currency: "CNY",
      limitMicros: requestedLimit,
      model: LIVE_MODEL,
      generationCallLimit: requestedGenerationLimit,
      searchCallLimit: requestedSearchLimit,
      createdAt: now,
      updatedAt: now,
      records: [],
    };
    await ledger.persist();
    return ledger;
  }

  snapshot(): BudgetLedgerState {
    return JSON.parse(JSON.stringify(this.state)) as BudgetLedgerState;
  }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.path);
  }

  async reserve(kind: CallKind, payload: unknown, fingerprintScope = ""): Promise<{ record: BudgetLedgerRecord; cached?: CachedResponse }> {
    return this.locked(async () => {
      const key = fingerprint(kind, payload, fingerprintScope);
      const existing = this.state.records.find((record) => record.fingerprint === key);
      if (existing?.status === "completed" && existing.cachedResponse) return { record: existing, cached: existing.cachedResponse };
      if (existing) throw new Error(existing.status === "pending" ? "LIVE_GATEWAY_CALL_IN_FLIGHT" : "LIVE_GATEWAY_CALL_UNCERTAIN");
      const kindCount = this.state.records.filter((record) => record.kind === kind).length;
      const kindLimit = kind === "generation" ? this.state.generationCallLimit : this.state.searchCallLimit;
      if (kindCount >= kindLimit) throw new Error(`LIVE_GATEWAY_${kind.toUpperCase()}_CALL_LIMIT`);
      const quoted = quote(kind, payload);
      const committed = this.state.records.reduce((sum, record) => sum + record.reservedMicros, 0);
      if (committed + quoted.reservedMicros > this.state.limitMicros) throw new Error("LIVE_GATEWAY_BUDGET_EXCEEDED");
      const now = new Date().toISOString();
      const record: BudgetLedgerRecord = {
        id: randomUUID(), fingerprint: key, kind, status: "pending", ...quoted,
        createdAt: now, updatedAt: now, upstreamAttempts: 1,
      };
      this.state.records.push(record);
      this.state.updatedAt = now;
      await this.persist();
      return { record };
    });
  }

  async complete(id: string, response: CachedResponse, usage: { inputTokens?: number; outputTokens?: number }): Promise<void> {
    await this.locked(async () => {
      const record = this.state.records.find((item) => item.id === id);
      if (!record || record.status !== "pending") throw new Error("LIVE_GATEWAY_RECORD_NOT_PENDING");
      record.status = "completed";
      record.cachedResponse = response;
      record.actualInputTokens = usage.inputTokens;
      record.actualOutputTokens = usage.outputTokens;
      record.updatedAt = new Date().toISOString();
      this.state.updatedAt = record.updatedAt;
      await this.persist();
    });
  }

  async uncertain(id: string, errorCode: string): Promise<void> {
    await this.locked(async () => {
      const record = this.state.records.find((item) => item.id === id);
      if (!record || record.status !== "pending") return;
      record.status = "uncertain";
      record.errorCode = errorCode.slice(0, 120);
      record.updatedAt = new Date().toISOString();
      this.state.updatedAt = record.updatedAt;
      await this.persist();
    });
  }
}

function sendCached(res: ServerResponse, cached: CachedResponse): void {
  const body = Buffer.from(cached.bodyBase64, "base64");
  res.writeHead(cached.status, { "content-type": cached.contentType, "content-length": String(body.length), "x-live-budget-cache": "1" });
  res.end(body);
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error("LIVE_GATEWAY_REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/BUDGET|CALL_LIMIT/.test(message)) return 429;
  if (/UNCERTAIN|IN_FLIGHT/.test(message)) return 409;
  if (/INVALID|MISMATCH|INPUT_LIMIT|REQUEST_TOO_LARGE/.test(message)) return 400;
  return 502;
}

export async function startLiveBudgetGateway(options: GatewayOptions): Promise<GatewayHandle> {
  if (!options.upstreamApiKey) throw new Error("LIVE_GATEWAY_API_KEY_REQUIRED");
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("LIVE_GATEWAY_LOOPBACK_ONLY");
  const generationEndpoint = checkedEndpoint(options.generationEndpoint ?? OFFICIAL_GENERATION_ENDPOINT, OFFICIAL_GENERATION_ENDPOINT, options.allowTestUpstream === true);
  const searchEndpoint = checkedEndpoint(options.searchEndpoint ?? OFFICIAL_SEARCH_ENDPOINT, OFFICIAL_SEARCH_ENDPOINT, options.allowTestUpstream === true);
  const ledger = await LiveBudgetLedger.open(options.ledgerPath, options);
  const inflight = new Map<string, Promise<CachedResponse>>();

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessionId: ledger.snapshot().sessionId }));
      return;
    }
    if (req.method !== "POST" || !req.url) {
      res.writeHead(404).end();
      return;
    }
    const kind: CallKind | null = req.url === "/compatible-mode/v1/chat/completions" ? "generation" : req.url === "/bailian-search" ? "search" : null;
    if (!kind) {
      res.writeHead(404).end();
      return;
    }
    try {
      const raw = JSON.parse((await readRequestBody(req)).toString("utf8"));
      const payload = kind === "generation" ? sanitizeGenerationPayload(raw) : sanitizeSearchPayload(raw);
      const key = fingerprint(kind, payload, options.fingerprintScope);
      const existingInflight = inflight.get(key);
      if (existingInflight) {
        sendCached(res, await existingInflight);
        return;
      }
      const operation = (async (): Promise<CachedResponse> => {
        const reserved = await ledger.reserve(kind, payload, options.fingerprintScope);
        if (reserved.cached) return reserved.cached;
        const endpoint = kind === "generation" ? generationEndpoint : searchEndpoint;
        try {
          const upstream = await fetch(endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${options.upstreamApiKey}`, "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(120_000),
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          if (body.length > 8_000_000) throw new Error("LIVE_GATEWAY_RESPONSE_TOO_LARGE");
          const contentType = upstream.headers.get("content-type") || "application/json";
          const cached: CachedResponse = { status: upstream.status, contentType, bodyBase64: body.toString("base64") };
          await ledger.complete(reserved.record.id, cached, usageFromResponse(kind, contentType, body));
          return cached;
        } catch (error) {
          await ledger.uncertain(reserved.record.id, error instanceof Error ? error.name : "upstream_error");
          throw error;
        }
      })();
      inflight.set(key, operation);
      try { sendCached(res, await operation); } finally { inflight.delete(key); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "LIVE_GATEWAY_ERROR";
      res.writeHead(errorStatus(error), { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message.replace(/[^A-Z0-9_:.-]/gi, "_").slice(0, 160) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LIVE_GATEWAY_ADDRESS_UNAVAILABLE");
  return {
    server,
    baseUrl: `http://${host}:${address.port}`,
    ledger,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.LIVE_BAILIAN_API_KEY || "";
  const ledgerPath = process.env.LIVE_BUDGET_LEDGER_PATH || "";
  if (!ledgerPath) throw new Error("LIVE_BUDGET_LEDGER_PATH is required");
  const gateway = await startLiveBudgetGateway({
    port: Number(process.env.LIVE_GATEWAY_PORT || 4317),
    ledgerPath,
    upstreamApiKey: apiKey,
    resume: process.env.LIVE_BUDGET_RESUME === "1",
    limitMicros: Number(process.env.LIVE_BUDGET_LIMIT_MICROS || LIVE_BUDGET_LIMIT_MICROS),
    generationCallLimit: Number(process.env.LIVE_GENERATION_CALL_LIMIT || LIVE_GENERATION_CALL_LIMIT),
    searchCallLimit: Number(process.env.LIVE_SEARCH_CALL_LIMIT || LIVE_SEARCH_CALL_LIMIT),
  });
  console.log(`[live-budget-gateway] listening=${gateway.baseUrl} model=${LIVE_MODEL} limit=CNY ${(LIVE_BUDGET_LIMIT_MICROS / 1_000_000).toFixed(6)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
