import { completeChatWithTools, getAIProviderAdapterCapabilities, resolveAIModelSelection, streamChat, type AIProvider, type ChatToolDefinition, type ToolCall, type ToolChatMessage } from "@/lib/ai";
import type { UserCredentials } from "@/lib/report";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { createTavilyRetrievalProvider } from "@/lib/intelligenceTavilyAdapter";
import { isOfficialDeepSeekBaseUrl } from "@/lib/intelligenceDeepSeekAdapter";
import {
  DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
  quoteDeepSeekGenerationReservation,
  type DeepSeekGenerationDurableLedger,
  type DeepSeekGenerationFailureDiagnostic,
  type DeepSeekGenerationUsage,
} from "@/lib/intelligenceDeepSeekGenerationBudget";
import { prepareDeepSeekAgentTurnInput } from "@/lib/intelligenceGenerationInput";

const INTELLIGENCE_GENERATION_TOTAL_TIMEOUT_MS = 90_000;

export interface IntelligenceProviderCapabilities {
  generation: boolean;
  nativeWebSearch: boolean;
  agenticToolUse?: boolean;
  toolCalling?: boolean;
  structuredOutput?: boolean;
}

export interface RetrievalRequest {
  input: IntelligenceTaskInput;
  start: Date;
  end?: Date;
  /** AI Researcher 自主生成的查询；为空时 Retrieval Provider 保持 legacy 规划兼容。 */
  queries?: string[];
  /**
   * Persist a completed provider batch before later research stages run.
   * The callback is owner-scoped by the caller and must be idempotent.
   */
  onBatch?: (batch: RetrievalBatchCheckpoint) => Promise<void>;
}

export interface RetrievalBatchCheckpoint {
  provider: string;
  query: string;
  results: WebSearchItem[];
}

export interface IntelligenceGenerationRequest {
  system: string;
  prompt: string;
  /** 不含用户内容的安全阶段标识，用于持久费用审计。 */
  phase?: string;
  /** OpenAI-compatible JSON mode; the caller remains responsible for schema validation. */
  responseFormat?: "json_object";
  /** Per-call output cap, bounded by the provider-wide audited maximum. */
  maxOutputTokens?: number;
  /**
   * Receives transient model chunks so callers can persist only complete,
   * schema-validated items. Raw chunks must never be logged or stored.
   */
  onOutputChunk?: (chunk: string) => void | Promise<void>;
}

export interface IntelligenceAgentTurnRequest {
  messages: ToolChatMessage[];
  tools: ChatToolDefinition[];
  /** 不含用户内容的安全阶段标识，用于持久费用审计。 */
  phase?: string;
}

export interface IntelligenceAgentTurnResult {
  content: string | null;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
  finishReason?: string | null;
}

export interface RetrievalRunResult {
  status: "success" | "partial" | "failed";
  results: WebSearchItem[];
  queryCount: number;
  errorCode?: string;
  coverageCapability?: "exact" | "coarse" | "unsupported";
  /** Provider 已逐批调用 request.onBatch；router 不得重复写入同一批次。 */
  batchesPersisted?: boolean;
}

export interface IntelligenceProvider {
  id: string;
  model?: string;
  capabilities: IntelligenceProviderCapabilities;
  generate?: (request: IntelligenceGenerationRequest) => Promise<string>;
  runAgentTurn?: (request: IntelligenceAgentTurnRequest) => Promise<IntelligenceAgentTurnResult>;
  searchWeb?: (request: RetrievalRequest) => Promise<RetrievalRunResult>;
}

export interface IntelligenceGenerationProviderOptions {
  deepSeekGenerationLedger?: DeepSeekGenerationDurableLedger;
  /** 真实 worker 对 DeepSeek 必须开启；普通会话和离线 provider 单测保持兼容。 */
  requireDeepSeekBudget?: boolean;
  streamChatImpl?: typeof streamChat;
  completeChatWithToolsImpl?: typeof completeChatWithTools;
}

interface GenerationAttemptProgress {
  startedAt: number;
  outputChars: number;
  usageReceived: boolean;
}

function boundedDiagnosticInteger(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** Classifies an exception without persisting its message or any request/response content. */
export function safeGenerationFailureDiagnostic(
  error: unknown,
  progress: GenerationAttemptProgress,
  forcedStage?: DeepSeekGenerationFailureDiagnostic["stage"],
): DeepSeekGenerationFailureDiagnostic {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  const message = error instanceof Error ? error.message : "";
  const numericStatus = typeof record.status === "number" ? record.status : Number.NaN;
  const httpStatus = Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599
    ? numericStatus
    : undefined;
  let category: DeepSeekGenerationFailureDiagnostic["category"] = "unknown";
  if (forcedStage === "settlement") category = "settlement";
  else if (name === "AICompletionTruncatedError" || /finish_reason=length|truncated_final_output/i.test(message)) category = "truncated";
  else if (/output too large/i.test(message)) category = "output_limit";
  else if (/timeout/i.test(name) || /timeout|timed out/i.test(code) || /timeout|timed out/i.test(message)) category = "timeout";
  else if (/abort/i.test(name) || /abort/i.test(code)) category = "aborted";
  else if (httpStatus !== undefined) category = "http";
  else if (/connection|socket/i.test(name) || /ECONN|EPIPE|ENET|EHOST|UND_ERR/i.test(code)) category = "connection";
  const stage = forcedStage
    ?? (category === "truncated" || category === "output_limit" || progress.usageReceived
      ? "response_validation"
      : progress.outputChars > 0 ? "stream" : "request");
  return {
    stage,
    category,
    elapsedMs: boundedDiagnosticInteger(Date.now() - progress.startedAt, 15 * 60_000),
    receivedOutput: progress.outputChars > 0,
    outputChars: boundedDiagnosticInteger(progress.outputChars, 48_001),
    usageReceived: progress.usageReceived,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

export interface RetrievalProvider {
  id: string;
  searchWeb(request: RetrievalRequest): Promise<RetrievalRunResult>;
}

export function createDefaultIntelligenceRetrievalProviders(): RetrievalProvider[] {
  return [createBailianRetrievalProvider(), createTavilyRetrievalProvider()];
}

export interface RetrievalProviderDiagnostic {
  provider: string;
  attempted: boolean;
  succeeded: boolean;
  queryCount: number;
  resultCount: number;
  errorCode?: string;
  queries?: string[];
  requestedStart?: string;
  requestedEnd?: string;
  coverageCapability?: "exact" | "coarse" | "unsupported";
  /** Provider 明确证明本次请求覆盖了声明范围；不得由结果条数或正文长度推断。 */
  coverageComplete?: boolean;
  status?: "success" | "partial" | "failed" | "not_configured";
  partialFailure?: boolean;
  errorCodes?: string[];
  attempts?: RetrievalProviderAttemptDiagnostic[];
}

export interface RetrievalProviderAttemptDiagnostic {
  succeeded: boolean;
  partialFailure?: boolean;
  queryCount: number;
  resultCount: number;
  errorCode?: string;
  queries?: string[];
  requestedStart?: string;
  requestedEnd?: string;
  coverageCapability?: "exact" | "coarse" | "unsupported";
  coverageComplete?: boolean;
}

export interface RetrievalResult {
  status: "success" | "partial" | "failed";
  providers: RetrievalProviderDiagnostic[];
  results: WebSearchItem[];
  /** Present for live adapters; optional to preserve historical/test result compatibility. */
  fetchedAt?: string;
}

export interface RetrievalSourceDiagnostic {
  url: string;
  title: string;
  fetchedAt: string | null;
  source?: string;
  sourceTier?: string | null;
  provider?: string | null;
  publishedAt?: string | null;
  evidenceStatus?: "full" | "partial" | "unavailable" | "not_selected" | null;
  exclusionReason?: string | null;
}

/**
 * Research Infrastructure 的 Search Router 契约。
 * Router 只编排 provider、聚合 diagnostics 并按 URL 去重，不负责研究语义判断。
 */
export interface IntelligenceSearchRouter {
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

function diagnosticAttempts(item: RetrievalProviderDiagnostic): RetrievalProviderAttemptDiagnostic[] {
  if (item.attempts?.length) return item.attempts.map((attempt) => ({ ...attempt, queries: attempt.queries ? [...attempt.queries] : undefined }));
  return [{
    succeeded: item.succeeded,
    ...(item.status === "partial" || item.partialFailure ? { partialFailure: true } : {}),
    queryCount: item.queryCount,
    resultCount: item.resultCount,
    ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    ...(item.queries ? { queries: [...item.queries] } : {}),
    ...(item.requestedStart ? { requestedStart: item.requestedStart } : {}),
    ...(item.requestedEnd ? { requestedEnd: item.requestedEnd } : {}),
    ...(item.coverageCapability ? { coverageCapability: item.coverageCapability } : {}),
    ...(item.coverageComplete === true ? { coverageComplete: true } : {}),
  }];
}

/**
 * 聚合多轮检索时保留逐次结果，避免把“曾成功”和“后来失败”压成
 * succeeded=true + errorCode=failed 这种无法解释的状态。
 */
export function aggregateRetrievalResults(runs: RetrievalResult[], maxResults?: number): RetrievalResult {
  const grouped = new Map<string, RetrievalProviderAttemptDiagnostic[]>();
  for (const run of runs) {
    for (const diagnostic of run.providers) {
      grouped.set(diagnostic.provider, [...(grouped.get(diagnostic.provider) ?? []), ...diagnosticAttempts(diagnostic)]);
    }
  }
  const coverageRank = { exact: 3, coarse: 2, unsupported: 1 } as const;
  const providers = [...grouped.entries()].map(([provider, attempts]): RetrievalProviderDiagnostic => {
    const active = attempts.filter((attempt) => attempt.errorCode !== "missing_credentials");
    const hasSuccess = active.some((attempt) => attempt.succeeded);
    const hasFailure = active.some((attempt) => !attempt.succeeded || !!attempt.errorCode || attempt.partialFailure === true);
    const status: NonNullable<RetrievalProviderDiagnostic["status"]> = active.length === 0
      ? "not_configured"
      : hasSuccess && hasFailure
        ? "partial"
        : hasSuccess
          ? "success"
          : "failed";
    const errorCodes = [...new Set(attempts.map((attempt) => attempt.errorCode).filter((value): value is string => !!value))];
    const queries = [...new Set(attempts.flatMap((attempt) => attempt.queries ?? []))];
    const coverageCapability = attempts.map((attempt) => attempt.coverageCapability).filter((value): value is NonNullable<RetrievalProviderAttemptDiagnostic["coverageCapability"]> => !!value)
      .sort((a, b) => coverageRank[b] - coverageRank[a])[0];
    const coverageComplete = active.length > 0 && active.every((attempt) => attempt.succeeded && attempt.coverageComplete === true);
    const latest = attempts[attempts.length - 1];
    return {
      provider,
      attempted: attempts.length > 0,
      succeeded: status === "success" || status === "partial",
      queryCount: attempts.reduce((sum, attempt) => sum + attempt.queryCount, 0),
      resultCount: attempts.reduce((sum, attempt) => sum + attempt.resultCount, 0),
      status,
      partialFailure: status === "partial",
      attempts,
      ...(errorCodes.length ? { errorCodes } : {}),
      ...(status === "failed" || status === "not_configured" ? { errorCode: errorCodes[errorCodes.length - 1] } : {}),
      ...(queries.length ? { queries } : {}),
      ...(latest?.requestedStart ? { requestedStart: latest.requestedStart } : {}),
      ...(latest?.requestedEnd ? { requestedEnd: latest.requestedEnd } : {}),
      ...(coverageCapability ? { coverageCapability } : {}),
      ...(coverageComplete ? { coverageComplete: true } : {}),
    };
  });
  const enabled = providers.filter((item) => item.status !== "not_configured");
  const hasSuccess = enabled.some((item) => item.status === "success" || item.status === "partial");
  const hasIncomplete = enabled.some((item) => item.status === "partial" || item.status === "failed");
  const status: RetrievalResult["status"] = !hasSuccess ? "failed" : hasIncomplete ? "partial" : "success";
  const results = runs.flatMap((run) => run.results)
    .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
    .slice(0, maxResults ?? Number.MAX_SAFE_INTEGER);
  const fetchedAt = runs.map((run) => run.fetchedAt).filter((value): value is string => !!value).sort().slice(-1)[0];
  return { status, providers, results, ...(fetchedAt ? { fetchedAt } : {}) };
}

export function createIntelligenceGenerationProvider(
  credentials?: Pick<UserCredentials, "provider" | "baseURL" | "apiKey"> & Partial<Pick<UserCredentials, "model" | "usingFreeQuota">> & { selectedProvider?: AIProvider; selectedModel?: string },
  options: IntelligenceGenerationProviderOptions = {},
): IntelligenceProvider {
  const selection = resolveAIModelSelection({
    selectedProvider: credentials?.selectedProvider,
    selectedModel: credentials?.selectedModel,
    credentialProvider: credentials?.provider,
    credentialModel: credentials?.model,
    useSystemConfiguration: credentials?.usingFreeQuota === true,
  });
  const adapterCapabilities = getAIProviderAdapterCapabilities(selection.provider);
  const agenticToolUse = !!credentials?.apiKey && adapterCapabilities.agenticToolUse;
  const ledger = selection.provider === "deepseek" ? options.deepSeekGenerationLedger : undefined;
  if (selection.provider === "deepseek" && options.requireDeepSeekBudget && !ledger) {
    throw new Error("DEEPSEEK_GENERATION_DURABLE_BUDGET_REQUIRED");
  }
  if (selection.provider === "deepseek" && options.requireDeepSeekBudget && !isOfficialDeepSeekBaseUrl(credentials?.baseURL)) {
    throw new Error("DEEPSEEK_GENERATION_OFFICIAL_ENDPOINT_REQUIRED");
  }
  const streamChatTransport = options.streamChatImpl ?? streamChat;
  const toolChatTransport = options.completeChatWithToolsImpl ?? completeChatWithTools;
  const guardedDeepSeekCall = async <T>(
    input: unknown,
    phase: string,
    maxOutputTokens: number,
    execute: (onUsage: (usage: DeepSeekGenerationUsage) => void, onOutput: (characters: number) => void) => Promise<T>,
  ): Promise<T> => {
    if (selection.provider !== "deepseek" || !ledger) return execute(() => {}, () => {});
    const spec = quoteDeepSeekGenerationReservation(input, selection.model, phase, maxOutputTokens);
    const reservationId = await ledger.reserve(spec);
    let usage: DeepSeekGenerationUsage | undefined;
    const progress: GenerationAttemptProgress = { startedAt: Date.now(), outputChars: 0, usageReceived: false };
    let result: T;
    try {
      result = await execute(
        (value) => { usage = value; progress.usageReceived = true; },
        (characters) => { progress.outputChars += Math.max(0, Math.round(characters)); },
      );
    } catch (error) {
      const diagnostic = safeGenerationFailureDiagnostic(error, progress);
      if (diagnostic.category === "truncated" && usage) {
        // finish_reason=length + usage 表示供应商已正常结束并给出可计费用量；
        // 结果不可发布，但调用状态不是 uncertain，不能误导用户或阻塞诊断。
        try {
          await ledger.complete(reservationId, usage);
          (error as Error & { externalCallCompleted?: boolean }).externalCallCompleted = true;
        } catch (settlementError) {
          await ledger.uncertain(reservationId, safeGenerationFailureDiagnostic(settlementError, progress, "settlement")).catch(() => {});
          throw settlementError;
        }
        throw error;
      }
      await ledger.uncertain(reservationId, diagnostic).catch(() => {});
      throw error;
    }
    try {
      await ledger.complete(reservationId, usage);
      return result;
    } catch (error) {
      // 供应商结果已返回，但持久结算结果未知；仍失败关闭且绝不自动重放。
      await ledger.uncertain(reservationId, safeGenerationFailureDiagnostic(error, progress, "settlement")).catch(() => {});
      throw error;
    }
  };
  return {
    id: credentials ? selection.provider : "unknown",
    model: credentials ? selection.model : undefined,
    capabilities: {
      generation: !!credentials,
      // Research retrieval is supplied by independent RetrievalProvider adapters.
      // A model's vendor-native search must not determine whether research works.
      nativeWebSearch: false,
      agenticToolUse,
      toolCalling: adapterCapabilities.toolCalling,
      structuredOutput: adapterCapabilities.structuredOutput,
    },
    ...(credentials?.apiKey
      ? {
          generate: async ({ system, prompt, phase, responseFormat, maxOutputTokens, onOutputChunk }: IntelligenceGenerationRequest) => {
            const outputTokenLimit = maxOutputTokens ?? DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS;
            if (!Number.isSafeInteger(outputTokenLimit) || outputTokenLimit <= 0 || outputTokenLimit > DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS) {
              throw new Error("INTELLIGENCE_GENERATION_OUTPUT_LIMIT_EXCEEDED");
            }
            return guardedDeepSeekCall(
              { kind: "generation", system, messages: [{ role: "user", content: prompt }], responseFormat, maxOutputTokens: outputTokenLimit },
              phase || "generation",
              outputTokenLimit,
              async (captureUsage, captureOutput) => {
              let output = "";
              for await (const chunk of streamChatTransport({
                provider: selection.provider,
                apiKey: credentials.apiKey,
                baseURL: credentials.baseURL,
                model: selection.model,
                system,
                messages: [{ role: "user", content: prompt }],
                responseFormat,
                rejectTruncatedOutput: true,
                maxOutputTokens: outputTokenLimit,
                maxRetries: 0,
                totalTimeoutMs: INTELLIGENCE_GENERATION_TOTAL_TIMEOUT_MS,
                onUsage: captureUsage,
              })) {
                output += chunk;
                captureOutput(chunk.length);
                await onOutputChunk?.(chunk);
                if (output.length > 48_000) throw new Error("intelligence generation output too large");
              }
              return output.trim();
              },
            );
          },
        }
      : {}),
    ...(agenticToolUse && credentials?.apiKey
      ? {
          runAgentTurn: (request: IntelligenceAgentTurnRequest) => {
            const prepared = selection.provider === "deepseek" && ledger
              ? prepareDeepSeekAgentTurnInput(request)
              : request;
            return guardedDeepSeekCall(
              { kind: "agent-turn", messages: prepared.messages, tools: prepared.tools },
              request.phase || "agent-turn",
              DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
              async (captureUsage, captureOutput) => {
                const response = await toolChatTransport({
                  provider: selection.provider,
                  apiKey: credentials.apiKey,
                  baseURL: credentials.baseURL,
                  model: selection.model,
                  messages: prepared.messages,
                  tools: prepared.tools,
                  maxOutputTokens: DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
                  maxRetries: 0,
                  totalTimeoutMs: INTELLIGENCE_GENERATION_TOTAL_TIMEOUT_MS,
                  onUsage: captureUsage,
                });
                captureOutput((response.content?.length || 0) + (response.reasoningContent?.length || 0));
                return response;
              },
            );
          },
        }
      : {}),
  };
}

export class IntelligenceRetrievalOrchestrator implements IntelligenceSearchRouter {
  constructor(
    private readonly generationProviders: IntelligenceProvider[] = [],
    private readonly independentProviders: RetrievalProvider[] = createDefaultIntelligenceRetrievalProviders(),
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const native = this.generationProviders.filter((provider) => provider.capabilities.nativeWebSearch && provider.searchWeb);
    const nativeProviders: Array<{ id: string; searchWeb: RetrievalProvider["searchWeb"] }> = native.map((provider) => ({ id: provider.id, searchWeb: provider.searchWeb! }));
    const diagnostics: RetrievalProviderDiagnostic[] = [];
    const results: WebSearchItem[] = [];

    const run = async (provider: { id: string; searchWeb: RetrievalProvider["searchWeb"] }) => {
      try {
        const run = await provider.searchWeb(request);
        if (request.onBatch && run.batchesPersisted !== true) {
          const queries = [...new Set((request.queries?.length ? request.queries : run.results.map((item) => item.query)).filter(Boolean))];
          for (const query of queries) {
            await request.onBatch({ provider: provider.id, query, results: run.results.filter((item) => item.query === query) });
          }
        }
        diagnostics.push({ provider: provider.id, attempted: true, succeeded: run.status !== "failed", queryCount: run.queryCount, resultCount: run.results.length, status: run.status, partialFailure: run.status === "partial", queries: request.queries || [], requestedStart: request.start.toISOString(), ...(request.end ? { requestedEnd: request.end.toISOString() } : {}), coverageCapability: run.coverageCapability ?? "unsupported", ...(run.errorCode ? { errorCode: run.errorCode } : {}) });
        run.results.forEach((item) => {
          const existing = results.find((candidate) => candidate.url === item.url);
          if (existing) existing.searchProviders = [...new Set([...(existing.searchProviders || []), provider.id])];
          else results.push({ ...item, searchProviders: [provider.id] });
        });
        return run.status;
      } catch (error) {
        if (error instanceof Error && error.message === "INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED") {
          throw error;
        }
        diagnostics.push({ provider: provider.id, attempted: true, succeeded: false, queryCount: 0, resultCount: 0, status: "failed", requestedStart: request.start.toISOString(), ...(request.end ? { requestedEnd: request.end.toISOString() } : {}), coverageCapability: "unsupported", errorCode: errorCode(error) });
        return "failed" as const;
      }
    };

    let nativeSucceeded = false;
    for (const provider of nativeProviders) {
      const status = await run(provider);
      if (status === "success") {
        nativeSucceeded = true;
        break;
      }
    }
    if (nativeProviders.length === 0 || !nativeSucceeded) {
      // 独立搜索供应商并行参与并合并结果，提升召回与权威来源覆盖。
      await Promise.all(this.independentProviders.map((provider) => run(provider)));
    }

    return aggregateRetrievalResults([{ status: "success", providers: diagnostics, results, fetchedAt: new Date().toISOString() }]);
  }
}

export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/missing credentials/i.test(message)) return "missing_credentials";
  if (/budget exhausted|budget[_ -](?:exceeded|exhausted)|search[_ -]call[_ -]limit/i.test(message)) return "budget_exhausted";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/http \d+/i.test(message)) return `upstream_${message.match(/http (\d+)/i)?.[1] ?? "error"}`;
  return "upstream_error";
}

export function safeRetrievalMetadata(result: RetrievalResult, counts: {
  searchCandidates: number;
  relevancePassed: number;
  relevanceDropped: number;
  evidence: { full: number; partial: number; unavailable: number };
  final: { facts: number; clues: number; trends: number };
  preEvidencePassed?: number;
  postEvidencePassed?: number;
  relevanceDropReasons?: Record<string, number>;
}): {
  status: RetrievalResult["status"];
  providers: RetrievalProviderDiagnostic[];
  sources?: RetrievalSourceDiagnostic[];
  searchCandidates: number;
  relevancePassed: number;
  relevanceDropped: number;
  evidence: { full: number; partial: number; unavailable: number };
  final: { facts: number; clues: number; trends: number };
  preEvidencePassed?: number;
  postEvidencePassed?: number;
  relevanceDropReasons?: Record<string, number>;
} {
  return {
    status: result.status,
    providers: result.providers,
    ...(result.results.length ? { sources: result.results.map((item) => ({ url: item.url, title: item.title, fetchedAt: result.fetchedAt || null })) } : {}),
    ...counts,
  };
}

export type IntelligenceGenerationProviderId = AIProvider | "unknown";
