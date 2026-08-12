import { completeChatWithTools, getAIProviderAdapterCapabilities, resolveAIModelSelection, resolveAIRequestReliability, streamChat, type AIProvider, type ChatToolDefinition, type ToolCall, type ToolChatMessage } from "@/lib/ai";
import type { UserCredentials } from "@/lib/report";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { createTavilyRetrievalProvider } from "@/lib/intelligenceTavilyAdapter";

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
  /** AI Researcher 自主生成的查询；为空时 Retrieval Provider 保持 legacy 规划兼容。 */
  queries?: string[];
}

export interface IntelligenceGenerationRequest {
  system: string;
  prompt: string;
  deadlineAt?: number;
}

export interface IntelligenceAgentTurnRequest {
  messages: ToolChatMessage[];
  tools: ChatToolDefinition[];
  deadlineAt?: number;
}

export interface IntelligenceAgentTurnResult {
  content: string | null;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
}

export interface RetrievalRunResult {
  status: "success" | "partial" | "failed";
  results: WebSearchItem[];
  queryCount: number;
  errorCode?: string;
}

export interface IntelligenceProvider {
  id: string;
  model?: string;
  capabilities: IntelligenceProviderCapabilities;
  generate?: (request: IntelligenceGenerationRequest) => Promise<string>;
  runAgentTurn?: (request: IntelligenceAgentTurnRequest) => Promise<IntelligenceAgentTurnResult>;
  searchWeb?: (request: RetrievalRequest) => Promise<RetrievalRunResult>;
}

export interface RetrievalProvider {
  id: string;
  searchWeb(request: RetrievalRequest): Promise<RetrievalRunResult>;
}

export interface RetrievalProviderDiagnostic {
  provider: string;
  attempted: boolean;
  succeeded: boolean;
  queryCount: number;
  resultCount: number;
  errorCode?: string;
}

export interface RetrievalResult {
  status: "success" | "partial" | "failed";
  providers: RetrievalProviderDiagnostic[];
  results: WebSearchItem[];
  /** Present for live adapters; optional to preserve historical/test result compatibility. */
  fetchedAt?: string;
}

/**
 * Research Infrastructure 的 Search Router 契约。
 * Router 只编排 provider、聚合 diagnostics 并按 URL 去重，不负责研究语义判断。
 */
export interface IntelligenceSearchRouter {
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

export function createIntelligenceGenerationProvider(
  credentials?: Pick<UserCredentials, "provider" | "baseURL" | "apiKey"> & Partial<Pick<UserCredentials, "model" | "usingFreeQuota">> & { selectedProvider?: AIProvider; selectedModel?: string },
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
  const researchReliability = resolveAIRequestReliability("research");
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
          generate: async ({ system, prompt, deadlineAt }: IntelligenceGenerationRequest) => {
            let output = "";
            for await (const chunk of streamChat({
              provider: selection.provider,
              apiKey: credentials.apiKey,
              baseURL: credentials.baseURL,
              model: selection.model,
              system,
              messages: [{ role: "user", content: prompt }],
              reliability: { ...researchReliability, deadlineAt },
            })) {
              output += chunk;
              if (output.length > 48_000) throw new Error("intelligence generation output too large");
            }
            return output.trim();
          },
        }
      : {}),
    ...(agenticToolUse && credentials?.apiKey
      ? {
          runAgentTurn: (request: IntelligenceAgentTurnRequest) => completeChatWithTools({
            provider: selection.provider,
            apiKey: credentials.apiKey,
            baseURL: credentials.baseURL,
            model: selection.model,
            messages: request.messages,
            tools: request.tools,
            reliability: { ...researchReliability, deadlineAt: request.deadlineAt },
          }),
        }
      : {}),
  };
}

export class IntelligenceRetrievalOrchestrator implements IntelligenceSearchRouter {
  constructor(
    private readonly generationProviders: IntelligenceProvider[] = [],
    private readonly independentProviders: RetrievalProvider[] = [createBailianRetrievalProvider(), createTavilyRetrievalProvider()],
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const native = this.generationProviders.filter((provider) => provider.capabilities.nativeWebSearch && provider.searchWeb);
    const nativeProviders: Array<{ id: string; searchWeb: RetrievalProvider["searchWeb"] }> = native.map((provider) => ({ id: provider.id, searchWeb: provider.searchWeb! }));
    const diagnostics: RetrievalProviderDiagnostic[] = [];
    const results: WebSearchItem[] = [];

    const run = async (provider: { id: string; searchWeb: RetrievalProvider["searchWeb"] }) => {
      try {
        const run = await provider.searchWeb(request);
        diagnostics.push({ provider: provider.id, attempted: true, succeeded: run.status !== "failed", queryCount: run.queryCount, resultCount: run.results.length, ...(run.errorCode ? { errorCode: run.errorCode } : {}) });
        results.push(...run.results);
        return run.status;
      } catch (error) {
        diagnostics.push({ provider: provider.id, attempted: true, succeeded: false, queryCount: 0, resultCount: 0, errorCode: errorCode(error) });
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
      for (const provider of this.independentProviders) {
        // Ordered providers are a real failover chain.  A partial result keeps
        // its evidence, then gives the next provider a chance to fill the gap.
        if ((await run(provider)) === "success") break;
      }
    }

    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
    const succeeded = diagnostics.filter((item) => item.succeeded).length;
    const failed = diagnostics.filter((item) => !item.succeeded).length;
    const status: RetrievalResult["status"] = succeeded === 0 ? "failed" : failed > 0 ? "partial" : "success";
    return { status, providers: diagnostics, results: unique, fetchedAt: new Date().toISOString() };
  }
}

export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/missing credentials/i.test(message)) return "missing_credentials";
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
}) {
  return {
    status: result.status,
    providers: result.providers,
    ...(result.results.length ? { sources: result.results.map((item) => ({ url: item.url, title: item.title, fetchedAt: result.fetchedAt || null })) } : {}),
    ...counts,
  };
}

export type IntelligenceGenerationProviderId = AIProvider | "unknown";
