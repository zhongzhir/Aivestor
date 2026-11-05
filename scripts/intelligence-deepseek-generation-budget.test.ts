import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AICompletionTruncatedError, completeChatWithTools, streamChat } from "@/lib/ai";
import { createIntelligenceGenerationProvider } from "@/lib/intelligenceProvider";
import {
  DEEPSEEK_GENERATION_MAX_INPUT_TOKENS,
  DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
  DEEPSEEK_SEARCH_REQUEST_USD_MICROS,
  DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
  quoteDeepSeekGenerationReservation,
  quoteDeepSeekGenerationUsdMicros,
  type DeepSeekGenerationDurableLedger,
  type DeepSeekGenerationFailureDiagnostic,
  type DeepSeekGenerationReservationSpec,
  type DeepSeekGenerationUsage,
} from "@/lib/intelligenceDeepSeekGenerationBudget";

class MemoryLedger implements DeepSeekGenerationDurableLedger {
  readonly rows: Array<{ id: string; spec: DeepSeekGenerationReservationSpec; status: "reserved" | "completed" | "uncertain"; usage?: DeepSeekGenerationUsage; diagnostic?: DeepSeekGenerationFailureDiagnostic }> = [];
  async reserve(spec: DeepSeekGenerationReservationSpec): Promise<string> {
    const id = `reservation-${this.rows.length + 1}`;
    this.rows.push({ id, spec, status: "reserved" });
    return id;
  }
  async complete(id: string, usage?: DeepSeekGenerationUsage): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    assert.ok(row && row.status === "reserved");
    row.status = "completed";
    row.usage = usage;
  }
  async uncertain(id: string, diagnostic?: DeepSeekGenerationFailureDiagnostic): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    assert.ok(row && row.status === "reserved");
    row.status = "uncertain";
    row.diagnostic = diagnostic;
  }
}

async function main() {
  const timeoutServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const timer = setInterval(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: null }] })}\n\n`);
    }, 50);
    request.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
  const address = timeoutServer.address();
  assert.ok(address && typeof address === "object");
  const timeoutStartedAt = Date.now();
  try {
    await assert.rejects(async () => {
      for await (const _chunk of streamChat({
        provider: "deepseek",
        apiKey: "offline-dummy-key",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        model: "deepseek-flash",
        system: "offline",
        messages: [{ role: "user", content: "offline" }],
        maxRetries: 0,
        totalTimeoutMs: 1_000,
      })) {
        // The local server deliberately emits frequent chunks; total timeout must still win.
      }
    }, /总时限/);
    assert.ok(Date.now() - timeoutStartedAt < 5_000, "流式小块不得无限延长整次调用时限");
  } finally {
    await new Promise<void>((resolve, reject) => timeoutServer.close((error) => error ? reject(error) : resolve()));
  }

  let jsonModeRequest: Record<string, unknown> | undefined;
  const jsonModeServer = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      jsonModeRequest = JSON.parse(body) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":true}" }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => jsonModeServer.listen(0, "127.0.0.1", resolve));
  const jsonModeAddress = jsonModeServer.address();
  assert.ok(jsonModeAddress && typeof jsonModeAddress === "object");
  try {
    let output = "";
    for await (const chunk of streamChat({
      provider: "deepseek",
      apiKey: "offline-dummy-key",
      baseURL: `http://127.0.0.1:${jsonModeAddress.port}/v1`,
      model: "deepseek-flash",
      system: "Return JSON only.",
      messages: [{ role: "user", content: "Return JSON." }],
      responseFormat: "json_object",
      maxOutputTokens: 3_072,
      rejectTruncatedOutput: true,
      maxRetries: 0,
      totalTimeoutMs: 5_000,
    })) output += chunk;
    assert.equal(output, '{"ok":true}');
    assert.deepEqual(jsonModeRequest?.response_format, { type: "json_object" }, "实际 OpenAI-compatible HTTP body 必须带 response_format");
    assert.equal(jsonModeRequest?.max_tokens, 3_072);
  } finally {
    await new Promise<void>((resolve, reject) => jsonModeServer.close((error) => error ? reject(error) : resolve()));
  }

  const ledger = new MemoryLedger();
  let streamingCalls = 0;
  const fakeStream: typeof streamChat = async function* (request) {
    streamingCalls++;
    assert.equal(request.maxRetries, 0, "真实情报生成必须关闭 SDK 隐式重试");
    assert.equal(request.maxOutputTokens, request.responseFormat === "json_object" ? 3_072 : DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS);
    assert.equal(request.totalTimeoutMs, 90_000);
    await request.onUsage?.({ inputTokens: 120, outputTokens: 24 });
    yield "{\"ok\":true}";
  };
  let toolCalls = 0;
  const fakeTools: typeof completeChatWithTools = async (request) => {
    toolCalls++;
    assert.equal(request.maxRetries, 0);
    assert.equal(request.maxOutputTokens, DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS);
    assert.equal(request.totalTimeoutMs, 90_000);
    await request.onUsage?.({ inputTokens: 200, outputTokens: 40 });
    return { content: "{}", reasoningContent: null, toolCalls: [], finishReason: "stop" };
  };
  const provider = createIntelligenceGenerationProvider({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "offline-dummy-key",
    baseURL: "https://api.deepseek.com/v1",
    usingFreeQuota: false,
  }, {
    deepSeekGenerationLedger: ledger,
    requireDeepSeekBudget: true,
    streamChatImpl: fakeStream,
    completeChatWithToolsImpl: fakeTools,
  });
  assert.equal(await provider.generate?.({ system: "system", prompt: "public test prompt", phase: "unit-generation" }), '{"ok":true}');
  assert.equal(await provider.generate?.({ system: "system JSON", prompt: "public JSON test prompt", phase: "unit-json-generation", responseFormat: "json_object", maxOutputTokens: 3_072 }), '{"ok":true}');
  await provider.runAgentTurn?.({ messages: [{ role: "user", content: "public tool test" }], tools: [], phase: "unit-agent-turn" });
  assert.equal(streamingCalls, 2);
  assert.equal(toolCalls, 1);
  assert.deepEqual(ledger.rows.map((row) => row.status), ["completed", "completed", "completed"]);
  assert.deepEqual(ledger.rows.map((row) => row.usage), [
    { inputTokens: 120, outputTokens: 24 },
    { inputTokens: 120, outputTokens: 24 },
    { inputTokens: 200, outputTokens: 40 },
  ]);
  assert.equal(ledger.rows.every((row) => row.spec.canonicalModel === "deepseek-flash"), true);
  assert.deepEqual(ledger.rows.map((row) => row.spec.phase), ["unit-generation", "unit-json-generation", "unit-agent-turn"]);
  assert.deepEqual(ledger.rows.map((row) => row.spec.maxOutputTokens), [8_192, 3_072, 8_192], "持久费用预留必须记录实际输出上限");

  const phaseRows = ledger.rows.length;
  await assert.rejects(
    provider.generate!({ system: "system", prompt: "public test prompt", phase: "private user content / invalid" }),
    /INVALID_PHASE/,
  );
  assert.equal(ledger.rows.length, phaseRows, "非法阶段标识必须在费用预留与 transport 前失败");
  await assert.rejects(
    provider.generate!({ system: "system", prompt: "public test prompt", phase: "oversized-output", maxOutputTokens: DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS + 1 }),
    /OUTPUT_LIMIT_EXCEEDED/,
  );
  assert.equal(streamingCalls, 2, "输出上限超标必须在 transport 前失败");
  assert.equal(ledger.rows.length, phaseRows, "输出上限超标不得产生费用预留");

  const timeoutLedger = new MemoryLedger();
  let timeoutCalls = 0;
  const timeoutStream: typeof streamChat = async function* () {
    timeoutCalls++;
    throw new Error("controlled timeout");
  };
  const timeoutProvider = createIntelligenceGenerationProvider({
    provider: "deepseek", model: "deepseek-flash", apiKey: "offline-dummy-key", baseURL: "https://api.deepseek.com",
  }, { deepSeekGenerationLedger: timeoutLedger, requireDeepSeekBudget: true, streamChatImpl: timeoutStream });
  await assert.rejects(timeoutProvider.generate!({ system: "s", prompt: "p" }), /controlled timeout/);
  assert.equal(timeoutCalls, 1, "超时不得在 provider 或 SDK 内重试");
  assert.equal(timeoutLedger.rows[0].status, "uncertain");
  assert.deepEqual(timeoutLedger.rows[0].diagnostic, {
    stage: "request",
    category: "timeout",
    elapsedMs: timeoutLedger.rows[0].diagnostic?.elapsedMs,
    receivedOutput: false,
    outputChars: 0,
    usageReceived: false,
  });

  const partialLedger = new MemoryLedger();
  const partialStream: typeof streamChat = async function* () {
    yield "partial-public-output";
    throw Object.assign(new Error("content-that-must-not-be-persisted"), { code: "ECONNRESET" });
  };
  const partialProvider = createIntelligenceGenerationProvider({
    provider: "deepseek", model: "deepseek-flash", apiKey: "offline-dummy-key", baseURL: "https://api.deepseek.com",
  }, { deepSeekGenerationLedger: partialLedger, requireDeepSeekBudget: true, streamChatImpl: partialStream });
  await assert.rejects(partialProvider.generate!({ system: "s", prompt: "p", phase: "partial-stream" }), /must-not-be-persisted/);
  assert.equal(partialLedger.rows[0].diagnostic?.stage, "stream");
  assert.equal(partialLedger.rows[0].diagnostic?.category, "connection");
  assert.equal(partialLedger.rows[0].diagnostic?.receivedOutput, true);
  assert.equal(partialLedger.rows[0].diagnostic?.outputChars, "partial-public-output".length);
  assert.equal(JSON.stringify(partialLedger.rows[0].diagnostic).includes("must-not-be-persisted"), false);

  const truncatedLedger = new MemoryLedger();
  const truncatedStream: typeof streamChat = async function* (request) {
    await request.onUsage?.({ inputTokens: 10, outputTokens: 4 });
    yield "truncated";
    throw new AICompletionTruncatedError();
  };
  const truncatedProvider = createIntelligenceGenerationProvider({
    provider: "deepseek", model: "deepseek-flash", apiKey: "offline-dummy-key", baseURL: "https://api.deepseek.com",
  }, { deepSeekGenerationLedger: truncatedLedger, requireDeepSeekBudget: true, streamChatImpl: truncatedStream });
  let observedTruncatedOutput = "";
  let completedTruncationError: unknown;
  try {
    await truncatedProvider.generate!({
      system: "s",
      prompt: "p",
      phase: "truncated-stream",
      maxOutputTokens: 2_048,
      onOutputChunk: (chunk) => { observedTruncatedOutput += chunk; },
    });
  } catch (error) {
    completedTruncationError = error;
  }
  assert.match(String(completedTruncationError), /finish_reason=length/);
  assert.equal((completedTruncationError as { externalCallCompleted?: boolean })?.externalCallCompleted, true);
  assert.equal(observedTruncatedOutput, "truncated", "production provider must forward transient chunks without persisting raw output");
  assert.equal(truncatedLedger.rows[0].status, "completed", "finish_reason=length 且 usage 已返回时调用状态是 completed，不得误记 uncertain");
  assert.equal(truncatedLedger.rows[0].spec.maxOutputTokens, 2_048);
  assert.deepEqual(truncatedLedger.rows[0].usage, { inputTokens: 10, outputTokens: 4 });
  assert.equal(truncatedLedger.rows[0].diagnostic, undefined);

  const settlementDiagnostics: DeepSeekGenerationFailureDiagnostic[] = [];
  const settlementLedger: DeepSeekGenerationDurableLedger = {
    reserve: async () => "settlement-reservation",
    complete: async () => { throw new Error("controlled ledger commit failure"); },
    uncertain: async (_id, diagnostic) => { if (diagnostic) settlementDiagnostics.push(diagnostic); },
  };
  const settlementProvider = createIntelligenceGenerationProvider({
    provider: "deepseek", model: "deepseek-flash", apiKey: "offline-dummy-key", baseURL: "https://api.deepseek.com",
  }, { deepSeekGenerationLedger: settlementLedger, requireDeepSeekBudget: true, streamChatImpl: fakeStream });
  await assert.rejects(settlementProvider.generate!({ system: "s", prompt: "p", phase: "settlement" }), /ledger commit failure/);
  assert.equal(settlementDiagnostics[0]?.stage, "settlement");
  assert.equal(settlementDiagnostics[0]?.category, "settlement");

  const tooLarge = "中".repeat(DEEPSEEK_GENERATION_MAX_INPUT_TOKENS);
  await assert.rejects(timeoutProvider.generate!({ system: "s", prompt: tooLarge }), /INPUT_LIMIT_EXCEEDED/);
  assert.equal(timeoutCalls, 1, "输入超限必须在 transport 前失败");
  assert.equal(timeoutLedger.rows.length, 1, "输入超限不得产生新的费用预留");

  assert.throws(() => quoteDeepSeekGenerationReservation({ prompt: "x" }, "unknown-model"), /UNKNOWN_PRICE/);
  const flashPeak = quoteDeepSeekGenerationUsdMicros("deepseek-flash", DEEPSEEK_GENERATION_MAX_INPUT_TOKENS, DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS);
  const proPeak = quoteDeepSeekGenerationUsdMicros("deepseek-v4-pro", DEEPSEEK_GENERATION_MAX_INPUT_TOKENS, DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS);
  assert.equal(flashPeak, 19_662);
  assert.equal(proPeak, 75_695);
  assert.equal(flashPeak + 2 * DEEPSEEK_SEARCH_REQUEST_USD_MICROS, 21_162);
  assert.equal(proPeak + 2 * DEEPSEEK_SEARCH_REQUEST_USD_MICROS, 77_195);
  assert.ok(proPeak + 2 * DEEPSEEK_SEARCH_REQUEST_USD_MICROS < DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS);
  assert.throws(() => quoteDeepSeekGenerationReservation({ prompt: "x" }, "deepseek-flash", "oversized-output", DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS + 1), /OUTPUT_LIMIT_EXCEEDED/);
  assert.throws(() => createIntelligenceGenerationProvider({
    provider: "deepseek", model: "deepseek-flash", apiKey: "offline-dummy-key", baseURL: "http://127.0.0.1:9999",
  }, { deepSeekGenerationLedger: new MemoryLedger(), requireDeepSeekBudget: true }), /OFFICIAL_ENDPOINT_REQUIRED/);
  console.log("intelligence DeepSeek generation budget tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
