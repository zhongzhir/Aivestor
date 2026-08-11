import assert from "node:assert/strict";
import { awaitWithTimeout, isRetryableAIError, resolveAIRequestReliability, runWithAIRetry, withIdleTimeout } from "@/lib/ai";

async function main() {
  const conversation = resolveAIRequestReliability("conversation", { AI_IDLE_TIMEOUT_MS: "1500", AI_MAX_RETRIES: "0" });
  assert.equal(conversation.idleTimeoutMs, 1500, "ordinary calls retain a short configurable timeout");
  assert.equal(conversation.maxRetries, 0);

  const research = resolveAIRequestReliability("research", { INTELLIGENCE_AI_IDLE_TIMEOUT_MS: "660000", INTELLIGENCE_AI_MAX_RETRIES: "2" });
  assert.equal(research.idleTimeoutMs, 660000, "research timeout must be independently configurable");
  assert.equal(resolveAIRequestReliability("research", {}).idleTimeoutMs, 600000, "research must wait at least ten minutes by default");

  let aborted = false;
  await assert.rejects(awaitWithTimeout(new Promise<void>(() => {}), 10, () => { aborted = true; }), /AI 服务响应超时/);
  assert.equal(aborted, true, "timeout must invoke the caller abort cleanup");

  assert.equal(isRetryableAIError({ status: 429 }), true);
  assert.equal(isRetryableAIError({ status: 500 }), true);
  assert.equal(isRetryableAIError({ status: 502 }), true);
  assert.equal(isRetryableAIError({ status: 503 }), true);
  assert.equal(isRetryableAIError({ status: 504 }), true);
  assert.equal(isRetryableAIError({ status: 400 }), false, "parameter errors must not retry");
  assert.equal(isRetryableAIError({ status: 401 }), false, "authentication errors must not retry");

  let attempts = 0;
  const retried = await runWithAIRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw { status: 503 };
    return "ok";
  }, { idleTimeoutMs: 1000, maxRetries: 2, retryBaseDelayMs: 0 });
  assert.equal(retried, "ok");
  assert.equal(attempts, 3, "retryable errors must use finite retries");

  let nonRetryAttempts = 0;
  await assert.rejects(runWithAIRetry(async () => {
    nonRetryAttempts += 1;
    throw { status: 401 };
  }, { idleTimeoutMs: 1000, maxRetries: 2, retryBaseDelayMs: 0 }), /\[object Object\]/);
  assert.equal(nonRetryAttempts, 1, "non-retryable errors must fail immediately");

  let idleAbort = false;
  let iteratorClosed = false;
  const stalled: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<string>>(() => {}),
        return: async () => { iteratorClosed = true; return { done: true, value: undefined }; },
      };
    },
  };
  await assert.rejects((async () => {
    for await (const _chunk of withIdleTimeout(stalled, 10, () => { idleAbort = true; })) {
      throw new Error("stalled stream must not yield");
    }
  })(), /AI 服务响应超时/);
  assert.equal(idleAbort, true, "idle timeout must abort the upstream request");
  assert.equal(iteratorClosed, true, "idle timeout must close the upstream iterator");

  console.log("AI timeout reliability tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
