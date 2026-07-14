import assert from "node:assert/strict";
import { userFacingAIError } from "../src/lib/aiError";
import {
  AI_STREAM_ERROR_PREFIX,
  decodeAIStreamError,
  encodeAIStreamError,
} from "../src/lib/aiStreamProtocol";
import { readTextStream } from "../src/lib/clientAI";

assert.match(
  userFacingAIError(
    Object.assign(new Error("Insufficient Balance"), { status: 402 }),
    { usingFreeQuota: true }
  ),
  /平台 AI 服务余额不足/,
  "platform-paid 402 errors should explain that the platform balance is unavailable"
);

assert.match(
  userFacingAIError(new Error("402 Insufficient Balance")),
  /当前 AI 服务商账户余额或配额不足/,
  "user-key 402 errors should tell the user to check their provider account"
);

assert.doesNotMatch(
  userFacingAIError(new Error("upstream leaked internal details")),
  /upstream leaked internal details/,
  "unknown upstream details should not be exposed to the client"
);

const encoded = encodeAIStreamError("可读错误");
assert.ok(encoded.startsWith(AI_STREAM_ERROR_PREFIX));
assert.equal(
  decodeAIStreamError(encoded.slice(AI_STREAM_ERROR_PREFIX.length)),
  "可读错误"
);

async function assertSplitStreamError(): Promise<void> {
  const encoder = new TextEncoder();
  const parts = [
    "已生成片段",
    encoded.slice(0, 8),
    encoded.slice(8, 23),
    encoded.slice(23),
  ];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    })
  );
  let visible = "";
  await assert.rejects(
    () => readTextStream(response, (chunk) => (visible += chunk)),
    /可读错误/,
    "stream errors split across network chunks should reach the error state"
  );
  assert.equal(
    visible,
    "已生成片段",
    "the internal stream marker must not be rendered as report content"
  );
}

assertSplitStreamError().then(() => {
  console.log("ai-stream-error tests passed");
});
