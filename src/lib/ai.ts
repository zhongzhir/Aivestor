import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { consumeQuota } from "@/lib/freeQuota";

// 统一 AI 调用层。
// 关键约束：平台不存储 API Key —— Key 由调用方（API 路由）从请求头透传进来，
// 用完即弃，不落库、不记录日志。

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
}

// OpenAI 兼容协议的服务商配置（DeepSeek / 通义千问 / 天翼 Token 均兼容 OpenAI 接口）
const OPENAI_COMPATIBLE: Record<
  Exclude<AIProvider, "claude">,
  { baseURL?: string; defaultModel: string }
> = {
  openai: { baseURL: undefined, defaultModel: "gpt-4o-mini" },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
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

// 流式聊天补全：返回文本增量的异步迭代器。
export async function* streamChat(
  req: ChatRequest
): AsyncGenerator<string, void, unknown> {
  if (req.provider === "claude") {
    const client = new Anthropic({ apiKey: req.apiKey });
    const stream = client.messages.stream({
      model: req.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: 8192,
      system: req.system,
      messages: req.messages,
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
    return;
  }

  const cfg = OPENAI_COMPATIBLE[req.provider];
  // 用户自定义 baseURL 优先（如天翼 Token / 自部署网关）
  const baseURL = req.baseURL?.trim() || cfg.baseURL;
  const client = new OpenAI({ apiKey: req.apiKey, baseURL });
  // 平台代付：开启 include_usage 让最后一帧带 usage，用于扣减额度
  const wantUsage = !!req.freeQuotaMeta;
  const stream = await client.chat.completions.create({
    model: req.model || cfg.defaultModel,
    stream: true,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    ...(wantUsage ? { stream_options: { include_usage: true } } : {}),
  });
  let promptTokens = 0;
  let completionTokens = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
    // OpenAI 兼容协议：include_usage 时最后一帧 usage 字段会出现
    const u = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (u) {
      promptTokens = u.prompt_tokens ?? promptTokens;
      completionTokens = u.completion_tokens ?? completionTokens;
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
