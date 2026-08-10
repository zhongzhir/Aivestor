import assert from "node:assert/strict";
import OpenAI from "openai";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const apiKey = process.env.SYSTEM_AI_API_KEY || process.env.BAILIAN_API_KEY;
const baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const model = "qwen-plus";

if (!apiKey) {
  throw new Error("Missing SYSTEM_AI_API_KEY (or BAILIAN_API_KEY) for real Qwen validation");
}

const client = new OpenAI({ apiKey, baseURL });
const events: Array<Record<string, unknown>> = [];

function summarizeMessage(message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined) {
  return {
    contentType: typeof message?.content,
    contentLength: typeof message?.content === "string" ? message.content.length : 0,
    reasoningContent: typeof (message as { reasoning_content?: unknown } | undefined)?.reasoning_content,
    toolCalls: (message?.tool_calls || []).map((call) => ({
      id: call.id,
      type: call.type,
      name: call.type === "function" ? call.function.name : undefined,
      arguments: call.type === "function" ? call.function.arguments : undefined,
    })),
  };
}

async function turn(label: string, messages: Message[], tools: Tool[]) {
  try {
    const response = await client.chat.completions.create({ model, messages, tools, tool_choice: "auto" });
    const message = response.choices[0]?.message;
    events.push({ label, httpStatus: 200, responseId: response.id, message: summarizeMessage(message) });
    assert.ok(message, `${label}: missing assistant message`);
    return message;
  } catch (error) {
    const e = error as { status?: number; name?: string; message?: string };
    events.push({ label, httpStatus: e.status ?? null, errorType: e.name, errorMessage: e.message });
    throw error;
  }
}

const lookupTool: Tool = {
  type: "function",
  function: {
    name: "lookup_company_capital_event",
    description: "查询指定公司最近发生的融资、上市、发行股票或债券等资本事件。",
    parameters: {
      type: "object",
      properties: { company: { type: "string" }, eventType: { type: "string" } },
      required: ["company", "eventType"],
      additionalProperties: false,
    },
  },
};

const searchTool: Tool = {
  type: "function",
  function: {
    name: "web_search",
    description: "搜索公开网页并返回候选结果。需要实时资料时必须调用。",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
};

const readTool: Tool = {
  type: "function",
  function: {
    name: "read_url",
    description: "读取 web_search 返回的 URL 全文。获得 URL 后必须调用以核验事实。",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
};

function toolMessage(call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall, result: unknown): Message {
  assert.equal(call.type, "function");
  if (call.type !== "function") throw new Error("Expected function tool call");
  return { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) };
}

async function singleToolValidation() {
  const messages: Message[] = [
    { role: "system", content: "你是协议验证助手。这个问题必须调用 lookup_company_capital_event，不能凭空回答。" },
    { role: "user", content: "请查询阿里巴巴最近一项融资或发行股票债券事件，并说明事件类型。" },
  ];
  const assistant = await turn("single-turn-1", messages, [lookupTool]);
  assert.ok(assistant.tool_calls?.length, "single-turn-1: expected tool_calls");
  const call = assistant.tool_calls?.find((item) => item.type === "function");
  assert.ok(call, "single-turn-1: expected function tool call");
  assert.equal(call.function.name, "lookup_company_capital_event");
  assert.doesNotThrow(() => JSON.parse(call.function.arguments));

  const final = await turn("single-turn-2", [
    ...messages,
    assistant,
    toolMessage(call, { company: "阿里巴巴", eventType: "债券发行", date: "2026-08-08", amount: "10亿元", source: "synthetic validation result" }),
  ], [lookupTool]);
  assert.ok(typeof final.content === "string" && final.content.length > 0, "single-turn-2: expected final natural-language answer");
  assert.equal(final.tool_calls?.length || 0, 0, "single-turn-2: should not repeat the same tool call");
}

async function twoToolValidation() {
  const messages: Message[] = [
    { role: "system", content: "你是研究助手。必须严格完成：先调用 web_search 搜索一个公开资本事件，再对搜索结果中的 URL 调用 read_url，最后仅用核验结果回答。不要跳过任何一步。" },
    { role: "user", content: "找一条近10天中国大模型企业的融资、上市或股票债券发行事件，先搜索再读取原文核验。" },
  ];
  const first = await turn("two-tool-1-search", messages, [searchTool, readTool]);
  assert.ok(first.tool_calls?.length, "two-tool-1-search: expected tool_calls");
  const searchCall = first.tool_calls?.find((item) => item.type === "function" && item.function.name === "web_search");
  assert.ok(searchCall, "two-tool-1-search: expected web_search");
  if (!searchCall || searchCall.type !== "function") throw new Error("two-tool-1-search: expected function web_search");
  assert.doesNotThrow(() => JSON.parse(searchCall.function.arguments));

  const second = await turn("two-tool-2-read", [
    ...messages,
    first,
    toolMessage(searchCall, { results: [{ title: "示例资本事件", url: "https://example.com/capital-event", snippet: "公开报道中的资本事件" }] }),
  ], [searchTool, readTool]);
  assert.ok(second.tool_calls?.length, "two-tool-2-read: expected second tool_calls");
  const readCall = second.tool_calls?.find((item) => item.type === "function" && item.function.name === "read_url");
  assert.ok(readCall, "two-tool-2-read: expected read_url after web_search");
  if (!readCall || readCall.type !== "function") throw new Error("two-tool-2-read: expected function read_url");
  assert.doesNotThrow(() => JSON.parse(readCall.function.arguments));

  const final = await turn("two-tool-3-final", [
    ...messages,
    first,
    toolMessage(searchCall, { results: [{ title: "示例资本事件", url: "https://example.com/capital-event", snippet: "公开报道中的资本事件" }] }),
    second,
    toolMessage(readCall, { url: "https://example.com/capital-event", title: "示例资本事件", content: "2026年8月8日，某中国大模型企业完成一笔融资。该内容仅用于协议验证。" }),
  ], [searchTool, readTool]);
  assert.ok(typeof final.content === "string" && final.content.length > 0, "two-tool-3-final: expected final natural-language answer");
  assert.equal(final.tool_calls?.length || 0, 0, "two-tool-3-final: expected no unnecessary repeat tool call");
}

async function main() {
  await singleToolValidation();
  await twoToolValidation();
  console.log(JSON.stringify({ status: "QWEN_AGENTIC_PROTOCOL_PASSED", provider: "qwen", model, baseURL, events }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "QWEN_AGENTIC_PROTOCOL_FAILED", provider: "qwen", model, baseURL, events }, null, 2));
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
