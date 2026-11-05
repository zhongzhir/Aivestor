import { Buffer } from "node:buffer";
import type { ChatToolDefinition, ToolChatMessage } from "@/lib/ai";
import {
  DEEPSEEK_GENERATION_MAX_INPUT_TOKENS,
  conservativeDeepSeekInputTokenUpperBound,
} from "@/lib/intelligenceDeepSeekGenerationBudget";

export interface AgentTurnInput {
  messages: ToolChatMessage[];
  tools: ChatToolDefinition[];
}

const MAX_TOOL_RESULTS = 16;
const MAX_TOOL_PAGES = 10;
const DETAIL_TEXT_CHARS = 420;

function text(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function compactResult(value: unknown, includeDetail: boolean): Record<string, unknown> {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    title: text(row.title, 240),
    url: text(row.url, 1_800),
    source: text(row.source ?? row.domain, 120),
    publishedAt: row.publishedAt ?? null,
    ...(row.sourceTier ? { sourceTier: text(row.sourceTier, 20) } : {}),
    ...(row.query ? { query: text(row.query, 240) } : {}),
    ...(includeDetail && row.snippet ? { snippet: text(row.snippet, DETAIL_TEXT_CHARS) } : {}),
  };
}

function compactPage(value: unknown, includeDetail: boolean): Record<string, unknown> {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    url: text(row.url, 1_800),
    title: text(row.title, 240),
    publishedAt: row.publishedAt ?? null,
    evidenceStatus: row.evidenceStatus ?? "unavailable",
    ...(includeDetail && row.content ? { content: text(row.content, DETAIL_TEXT_CHARS) } : {}),
  };
}

function compactToolContent(content: string, includeDetail: boolean): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return JSON.stringify({ notice: "工具结果已压缩", value: text(content, includeDetail ? 1_000 : 200) });
    }
    const row = parsed as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of ["notice", "status", "error"] as const) {
      if (row[key] !== undefined) output[key] = typeof row[key] === "string" ? text(row[key], 300) : row[key];
    }
    if (Array.isArray(row.results)) {
      output.resultCount = row.results.length;
      output.results = row.results.slice(0, MAX_TOOL_RESULTS).map((item) => compactResult(item, includeDetail));
    }
    if (Array.isArray(row.pages)) {
      output.pageCount = row.pages.length;
      output.pages = row.pages.slice(0, MAX_TOOL_PAGES).map((item) => compactPage(item, includeDetail));
    }
    if (Array.isArray(row.sources)) {
      output.sourceCount = row.sources.length;
      output.sources = row.sources.slice(0, MAX_TOOL_RESULTS).map((item) => compactResult(item, false));
    }
    if (Object.keys(output).length <= 1) {
      output.summary = "工具结果正文已压缩；运行时仍保留完整来源池和证据状态。";
      output.originalBytes = Buffer.byteLength(content, "utf8");
    }
    return JSON.stringify(output);
  } catch {
    return JSON.stringify({ notice: "无法解析的工具结果已压缩", originalBytes: Buffer.byteLength(content, "utf8") });
  }
}

function requestInputUpperBound(input: AgentTurnInput): number {
  return conservativeDeepSeekInputTokenUpperBound({ kind: "agent-turn", messages: input.messages, tools: input.tools });
}

function compactToolMessages(input: AgentTurnInput, includeDetail: boolean): AgentTurnInput {
  return {
    tools: input.tools,
    messages: input.messages.map((message) => message.role === "tool"
      ? { ...message, content: compactToolContent(message.content, includeDetail) }
      : message.role === "assistant" && message.reasoning_content
        ? { ...message, reasoning_content: null }
        : { ...message }),
  };
}

function summarizeOldestToolMessage(input: AgentTurnInput, index: number): AgentTurnInput {
  return {
    tools: input.tools,
    messages: input.messages.map((message, messageIndex) => messageIndex === index && message.role === "tool"
      ? {
          ...message,
          content: JSON.stringify({
            notice: "较早工具结果已从模型上下文移除以遵守输入上限；完整来源仍保留在本次运行的来源池，可用 inspect_sources 查看。",
            originalBytes: Buffer.byteLength(message.content, "utf8"),
          }),
        }
      : message),
  };
}

/**
 * DeepSeek 的持久预算以 UTF-8 bytes + 协议余量作为 token 保守上界。
 * 这里压缩的是发给模型的副本，不修改运行时来源池、证据或审计数据。
 * tool_call / tool message 仍成对保留，避免破坏 OpenAI-compatible 协议。
 */
export function prepareDeepSeekAgentTurnInput(input: AgentTurnInput): AgentTurnInput {
  if (requestInputUpperBound(input) <= DEEPSEEK_GENERATION_MAX_INPUT_TOKENS) return input;

  let prepared = compactToolMessages(input, true);
  if (requestInputUpperBound(prepared) <= DEEPSEEK_GENERATION_MAX_INPUT_TOKENS) return prepared;

  prepared = compactToolMessages(prepared, false);
  if (requestInputUpperBound(prepared) <= DEEPSEEK_GENERATION_MAX_INPUT_TOKENS) return prepared;

  const toolIndexes = prepared.messages
    .map((message, index) => message.role === "tool" ? index : -1)
    .filter((index) => index >= 0);
  // 优先保留最新工具结果；从最早结果开始只留下可恢复说明。
  for (const index of toolIndexes.slice(0, -1)) {
    prepared = summarizeOldestToolMessage(prepared, index);
    if (requestInputUpperBound(prepared) <= DEEPSEEK_GENERATION_MAX_INPUT_TOKENS) return prepared;
  }

  throw new Error("INTELLIGENCE_AGENT_CONTEXT_LIMIT_EXCEEDED");
}

export function deepSeekAgentTurnInputUpperBound(input: AgentTurnInput): number {
  return requestInputUpperBound(input);
}
