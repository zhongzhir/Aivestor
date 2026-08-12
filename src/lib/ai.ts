import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { consumeQuota } from "@/lib/freeQuota";

// 统一 AI 调用层。
// 关键约束：本层只接收调用方传入的明文 Key，不自行读取或持久化。
// 用户自带 Key 在 API 路由层按需解密后传入；平台代付 Key 来自环境变量。

export type AIProvider =
  | "deepseek"
  | "openai"
  | "qwen"
  | "claude"
  | "ctyun"
  | "zhipu"
  | "moonshot";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  provider: AIProvider;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  model?: string;
  // 覆盖默认 baseURL（仅对 OpenAI 兼容协议有效；Claude 走 Anthropic SDK 不读此值）
  baseURL?: string;
  // 若使用平台免费额度，传入用户 id / 功能名；流结束后会扣减额度
  freeQuotaMeta?: {
    userId: string;
    feature: string;
  };
  reliability?: AIRequestReliability;
}

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

export type ToolChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolChatRequest {
  provider: AIProvider;
  apiKey: string;
  baseURL?: string;
  model?: string;
  messages: ToolChatMessage[];
  tools: ChatToolDefinition[];
  reliability?: AIRequestReliability;
}

export interface ToolChatResponse {
  content: string | null;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
}

// OpenAI 兼容协议的服务商配置（DeepSeek / 通义千问 / 天翼 Token 均兼容 OpenAI 接口）
const OPENAI_COMPATIBLE: Record<
  Exclude<AIProvider, "claude">,
  { baseURL?: string; defaultModel: string }
> = {
  openai: { baseURL: undefined, defaultModel: "gpt-4o-mini" },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  ctyun: {
    baseURL: "https://api.ctyun.cn/v1",
    defaultModel: "deepseek-chat",
  },
  zhipu: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
  },
  moonshot: {
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },
};

const DEFAULT_CLAUDE_MODEL = "claude-3-5-sonnet-latest";

export function defaultAIModel(provider: AIProvider): string {
  return provider === "claude" ? DEFAULT_CLAUDE_MODEL : OPENAI_COMPATIBLE[provider].defaultModel;
}

export interface AIProviderAdapterCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  /** True only after this provider's multi-turn tool protocol has passed real validation. */
  agenticToolUse: boolean;
}

const PROVIDER_CAPABILITIES: Record<AIProvider, AIProviderAdapterCapabilities> = {
  deepseek: { toolCalling: true, structuredOutput: true, agenticToolUse: true },
  openai: { toolCalling: false, structuredOutput: true, agenticToolUse: false },
  qwen: { toolCalling: true, structuredOutput: true, agenticToolUse: true },
  claude: { toolCalling: false, structuredOutput: true, agenticToolUse: false },
  ctyun: { toolCalling: false, structuredOutput: true, agenticToolUse: false },
  zhipu: { toolCalling: false, structuredOutput: true, agenticToolUse: false },
  moonshot: { toolCalling: false, structuredOutput: true, agenticToolUse: false },
};

export function getAIProviderAdapterCapabilities(provider: AIProvider): AIProviderAdapterCapabilities {
  return { ...PROVIDER_CAPABILITIES[provider] };
}

export interface AIModelSelection {
  provider: AIProvider;
  model: string;
  source: "explicit" | "credentials" | "system" | "adapter-default";
}

export function resolveAIModelSelection(options: {
  selectedProvider?: AIProvider;
  selectedModel?: string;
  credentialProvider?: AIProvider;
  credentialModel?: string;
  useSystemConfiguration?: boolean;
  env?: Record<string, string | undefined>;
} = {}): AIModelSelection {
  const env = options.env || process.env;
  const configuredProvider = env.SYSTEM_AI_PROVIDER?.trim().toLowerCase();
  const systemProvider = configuredProvider && isValidProvider(configuredProvider) ? configuredProvider : undefined;
  const provider = options.selectedProvider || options.credentialProvider || systemProvider || "deepseek";
  const selectedModel = options.selectedModel?.trim();
  if (selectedModel) return { provider, model: selectedModel, source: "explicit" };
  const credentialModel = options.credentialModel?.trim();
  if (credentialModel) return { provider, model: credentialModel, source: "credentials" };
  const systemModel = options.useSystemConfiguration !== false ? env.SYSTEM_AI_MODEL?.trim() : undefined;
  if (systemModel) return { provider, model: systemModel, source: "system" };
  return { provider, model: defaultAIModel(provider), source: "adapter-default" };
}

export interface AIRequestReliability {
  /** 建连、首个可见 token 和后续可见 token 之间允许的最大等待时间。 */
  idleTimeoutMs: number;
  /** 额外尝试次数；不会重试鉴权或参数错误。 */
  maxRetries: number;
  retryBaseDelayMs: number;
  /** Absolute deadline shared by a multi-step caller, when applicable. */
  deadlineAt?: number;
}

export type AIRequestProfile = "conversation" | "research";

const DEFAULT_CONVERSATION_RELIABILITY: AIRequestReliability = {
  idleTimeoutMs: 60_000,
  maxRetries: 1,
  retryBaseDelayMs: 500,
};

const DEFAULT_RESEARCH_RELIABILITY: AIRequestReliability = {
  // Research may legitimately wait through a long reasoning/tool-planning phase.
  // Keep-alive frames filtered by an SDK are not treated as user-visible progress.
  idleTimeoutMs: 10 * 60_000,
  maxRetries: 2,
  retryBaseDelayMs: 1_000,
};

function boundedEnvNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

/**
 * A provider-neutral reliability profile. Research callers opt in explicitly;
 * all other product calls retain the short interactive default.
 */
export function resolveAIRequestReliability(profile: AIRequestProfile = "conversation", env: Record<string, string | undefined> = process.env): AIRequestReliability {
  const defaults = profile === "research" ? DEFAULT_RESEARCH_RELIABILITY : DEFAULT_CONVERSATION_RELIABILITY;
  const prefix = profile === "research" ? "INTELLIGENCE_AI_" : "AI_";
  return {
    idleTimeoutMs: boundedEnvNumber(env[`${prefix}IDLE_TIMEOUT_MS`], defaults.idleTimeoutMs, 1_000, 30 * 60_000),
    maxRetries: boundedEnvNumber(env[`${prefix}MAX_RETRIES`], defaults.maxRetries, 0, 4),
    retryBaseDelayMs: boundedEnvNumber(env[`${prefix}RETRY_BASE_DELAY_MS`], defaults.retryBaseDelayMs, 0, 30_000),
  };
}

class AITimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `AI 服务响应超时（${timeoutMs / 1000}s 无数据），请稍后重试`
    );
    this.name = "AITimeoutError";
  }
}

// 给“建立连接 / 拿到流对象”这一步加超时：超时则中止上游并抛错。
export async function awaitWithTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new AITimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } catch (e) {
    // 超时后上游 promise 可能稍后被 abort 拒绝，吞掉以免 unhandled rejection
    p.catch(() => {});
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 给任意异步可迭代流加“空闲看门狗”：两次产出间隔超时则中止上游并抛错。
export async function* withIdleTimeout<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number,
  onTimeout: () => void
): AsyncGenerator<T, void, unknown> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      const nextP = iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new AITimeoutError(timeoutMs));
        }, timeoutMs);
      });
      let result: IteratorResult<T>;
      try {
        result = await Promise.race([nextP, timeout]);
      } catch (e) {
        nextP.catch(() => {}); // 吞掉中止后上游的迟到拒绝
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

export class AIRequestDeadlineError extends Error {
  readonly code = "research_total_timeout";
  constructor() {
    super("research_total_timeout");
    this.name = "AIRequestDeadlineError";
  }
}

export function remainingAIRequestTime(reliability: AIRequestReliability, now = Date.now()): number {
  return reliability.deadlineAt === undefined ? Number.POSITIVE_INFINITY : reliability.deadlineAt - now;
}

function reliabilityForAttempt(reliability: AIRequestReliability): AIRequestReliability {
  const remaining = remainingAIRequestTime(reliability);
  if (remaining <= 0) throw new AIRequestDeadlineError();
  return { ...reliability, idleTimeoutMs: Math.min(reliability.idleTimeoutMs, remaining) };
}

function statusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function isRetryableAIError(error: unknown): boolean {
  if (error instanceof AITimeoutError) return true;
  const status = statusFromError(error);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function runWithAIRetry<T>(operation: (attemptReliability: AIRequestReliability) => Promise<T>, reliability: AIRequestReliability, sleep: (delayMs: number) => Promise<void> = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation(reliabilityForAttempt(reliability));
    } catch (error) {
      if (error instanceof AIRequestDeadlineError) throw error;
      if (!isRetryableAIError(error) || attempt >= reliability.maxRetries) throw error;
      const delayMs = reliability.retryBaseDelayMs * 2 ** attempt;
      if (remainingAIRequestTime(reliability) <= delayMs) throw new AIRequestDeadlineError();
      attempt += 1;
      await sleep(delayMs);
    }
  }
}

export function isValidProvider(v: string): v is AIProvider {
  return [
    "deepseek",
    "openai",
    "qwen",
    "claude",
    "ctyun",
    "zhipu",
    "moonshot",
  ].includes(v);
}

// 给前端 / 测试连接路由共用：取默认 baseURL（仅 OpenAI 兼容）
export function defaultBaseURL(provider: AIProvider): string | null {
  if (provider === "claude") return null;
  return OPENAI_COMPATIBLE[provider]?.baseURL ?? null;
}

/**
 * OpenAI-compatible non-streaming tool turn. The caller owns the multi-turn
 * loop and must pass the returned assistant message (including DeepSeek's
 * reasoning_content) back on the next request.
 */
export async function completeChatWithTools(req: ToolChatRequest): Promise<ToolChatResponse> {
  if (req.provider === "claude") throw new Error("tool calling is not configured for this provider");
  const cfg = OPENAI_COMPATIBLE[req.provider];
  const reliability = req.reliability || resolveAIRequestReliability();
  const client = new OpenAI({ apiKey: req.apiKey, baseURL: req.baseURL?.trim() || cfg.baseURL });
  const response = await runWithAIRetry(async (attemptReliability) => {
    const controller = new AbortController();
    return await awaitWithTimeout(
      client.chat.completions.create({
        model: req.model || cfg.defaultModel,
        stream: false,
        messages: req.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools: req.tools as OpenAI.Chat.Completions.ChatCompletionTool[],
        tool_choice: "auto",
      }, { signal: controller.signal }),
      attemptReliability.idleTimeoutMs,
      () => controller.abort(),
    );
  }, reliability,
  );
  const message = response.choices[0]?.message;
  if (!message) throw new Error("AI tool response missing message");
  const raw = message as typeof message & { reasoning_content?: string | null };
  const toolCalls: ToolCall[] = (message.tool_calls || []).flatMap((call) => {
    if (call.type !== "function" || !call.id || !call.function?.name) return [];
    return [{ id: call.id, type: "function" as const, function: { name: call.function.name, arguments: call.function.arguments || "{}" } }];
  });
  return {
    content: typeof message.content === "string" ? message.content : null,
    reasoningContent: typeof raw.reasoning_content === "string" ? raw.reasoning_content : null,
    toolCalls,
  };
}

// 流式聊天补全：返回文本增量的异步迭代器。
export async function* streamChat(
  req: ChatRequest
): AsyncGenerator<string, void, unknown> {
  const reliability = req.reliability || resolveAIRequestReliability();
  let retries = 0;
  let emittedContent = false;
  let promptTokens = 0;
  let completionTokens = 0;

  const retryOrThrow = async (error: unknown): Promise<void> => {
    if (error instanceof AIRequestDeadlineError) throw error;
    if (emittedContent || !isRetryableAIError(error) || retries >= reliability.maxRetries) throw error;
    const delayMs = reliability.retryBaseDelayMs * 2 ** retries;
    if (remainingAIRequestTime(reliability) <= delayMs) throw new AIRequestDeadlineError();
    retries += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  };

  if (req.provider === "claude") {
    for (;;) {
      const attemptReliability = reliabilityForAttempt(reliability);
      const client = new Anthropic({ apiKey: req.apiKey });
      const controller = new AbortController();
      try {
        const stream = client.messages.stream(
          {
            model: req.model || DEFAULT_CLAUDE_MODEL,
            max_tokens: 8192,
            system: req.system,
            messages: req.messages,
          },
          { signal: controller.signal }
        );
        for await (const event of withIdleTimeout(stream, attemptReliability.idleTimeoutMs, () => controller.abort())) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            emittedContent = true;
            yield event.delta.text;
          }
        }
        return;
      } catch (error) {
        controller.abort();
        await retryOrThrow(error);
      }
    }
  }

  const cfg = OPENAI_COMPATIBLE[req.provider];
  // 用户自定义 baseURL 优先（如天翼 Token / 自部署网关）
  const baseURL = req.baseURL?.trim() || cfg.baseURL;
  const client = new OpenAI({ apiKey: req.apiKey, baseURL });
  // 平台代付：开启 include_usage 让最后一帧带 usage，用于扣减额度
  const wantUsage = !!req.freeQuotaMeta;
  for (;;) {
    const attemptReliability = reliabilityForAttempt(reliability);
    const controller = new AbortController();
    try {
      const stream = await awaitWithTimeout(
        client.chat.completions.create(
          {
            model: req.model || cfg.defaultModel,
            stream: true,
            messages: [{ role: "system", content: req.system }, ...req.messages],
            ...(wantUsage ? { stream_options: { include_usage: true } } : {}),
          },
          { signal: controller.signal }
        ),
        attemptReliability.idleTimeoutMs,
        () => controller.abort()
      );
      for await (const chunk of withIdleTimeout(stream, attemptReliability.idleTimeoutMs, () => controller.abort())) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emittedContent = true;
          yield delta;
        }
        // OpenAI 兼容协议：include_usage 时最后一帧 usage 字段会出现
        const u = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (u) {
          promptTokens = u.prompt_tokens ?? promptTokens;
          completionTokens = u.completion_tokens ?? completionTokens;
        }
      }
      break;
    } catch (error) {
      controller.abort();
      await retryOrThrow(error);
    }
  }
  if (req.freeQuotaMeta && (promptTokens > 0 || completionTokens > 0)) {
    await consumeQuota(
      req.freeQuotaMeta.userId,
      promptTokens,
      completionTokens,
      req.freeQuotaMeta.feature
    );
  }
}
