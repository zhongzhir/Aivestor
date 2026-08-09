import { streamChat, type AIProvider } from "@/lib/ai";
import type { UserCredentials } from "@/lib/report";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";

export interface IntelligenceProviderCapabilities {
  generation: boolean;
  nativeWebSearch: boolean;
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
}

export interface RetrievalRunResult {
  status: "success" | "partial" | "failed";
  results: WebSearchItem[];
  queryCount: number;
  errorCode?: string;
}

export interface IntelligenceProvider {
  id: string;
  capabilities: IntelligenceProviderCapabilities;
  generate?: (request: IntelligenceGenerationRequest) => Promise<string>;
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
}

function isDashScopeQwen(credentials: Pick<UserCredentials, "provider" | "baseURL" | "apiKey">): boolean {
  return credentials.provider === "qwen" &&
    !!credentials.apiKey &&
    (!credentials.baseURL || credentials.baseURL.includes("dashscope.aliyuncs.com"));
}

export function createIntelligenceGenerationProvider(
  credentials?: Pick<UserCredentials, "provider" | "baseURL" | "apiKey">,
): IntelligenceProvider {
  const nativeWebSearch = !!credentials && isDashScopeQwen(credentials);
  return {
    id: credentials?.provider ?? "unknown",
    capabilities: { generation: !!credentials, nativeWebSearch },
    ...(credentials?.apiKey
      ? {
          generate: async ({ system, prompt }: IntelligenceGenerationRequest) => {
            let output = "";
            for await (const chunk of streamChat({
              provider: credentials.provider,
              apiKey: credentials.apiKey,
              baseURL: credentials.baseURL,
              system,
              messages: [{ role: "user", content: prompt }],
            })) {
              output += chunk;
              if (output.length > 48_000) throw new Error("intelligence generation output too large");
            }
            return output.trim();
          },
        }
      : {}),
    ...(nativeWebSearch
      ? { searchWeb: createBailianRetrievalProvider({ apiKey: credentials.apiKey, model: undefined }) .searchWeb }
      : {}),
  };
}

export class IntelligenceRetrievalOrchestrator {
  constructor(
    private readonly generationProviders: IntelligenceProvider[] = [],
    private readonly independentProviders: RetrievalProvider[] = [createBailianRetrievalProvider()],
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
      if (status !== "failed") {
        nativeSucceeded = true;
        break;
      }
    }
    if (nativeProviders.length === 0 || !nativeSucceeded) {
      for (const provider of this.independentProviders) {
        await run(provider);
      }
    }

    const unique = results.filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
    const succeeded = diagnostics.filter((item) => item.succeeded).length;
    const failed = diagnostics.filter((item) => !item.succeeded).length;
    const status: RetrievalResult["status"] = succeeded === 0 ? "failed" : failed > 0 ? "partial" : "success";
    return { status, providers: diagnostics, results: unique };
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
    ...counts,
  };
}

export type IntelligenceGenerationProviderId = AIProvider | "unknown";
