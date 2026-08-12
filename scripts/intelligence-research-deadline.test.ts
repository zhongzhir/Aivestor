import assert from "node:assert/strict";
import { AIRequestDeadlineError, awaitWithTimeout, runWithAIRetry } from "@/lib/ai";
import { resolveResearchBudget, runIntelligenceAgentRuntime } from "@/lib/intelligenceAgentRuntime";
import { normalizeTaskInput } from "@/lib/intelligence";
import type { IntelligenceProvider } from "@/lib/intelligenceProvider";

const input = normalizeTaskInput({ name: "deadline test", topics: ["AI"], isActive: true });
const retrieval = { retrieve: async () => ({ status: "failed" as const, providers: [], results: [] }) };

async function main() {
  assert.equal(resolveResearchBudget({}).maxDurationMs, 600_000, "research total deadline must share the 10-minute default");
  assert.equal(resolveResearchBudget({ INTELLIGENCE_RESEARCH_TOTAL_TIMEOUT_MS: "120000" }).maxDurationMs, 120000, "research total deadline must be configurable");

  const immediate: IntelligenceProvider = {
    id: "test", capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn({ deadlineAt }) {
      assert.ok((deadlineAt || 0) > Date.now(), "agent turn must receive the remaining total deadline");
      return { content: JSON.stringify({ answer: "ok", items: [], searchedAreas: [], unresolvedGaps: [], confidence: "low" }), reasoningContent: null, toolCalls: [] };
    },
    async generate() { throw new Error("must not finalize"); },
  };
  const completed = await runIntelligenceAgentRuntime<string>({
    input, start: new Date(), generationProvider: immediate, retrieval, systemInstruction: "system", taskPrompt: "task", finalizationInstruction: "final",
    parseFinal: (raw) => ({ value: JSON.parse(raw).answer, searchedAreas: [], unresolvedGaps: [], confidence: "low", itemCount: 0 }),
    budget: { maxDurationMs: 100 },
  });
  assert.equal(completed.report, "ok", "request inside the total deadline must complete");

  let aborted = false;
  await assert.rejects(
    runWithAIRetry(async (attempt) => awaitWithTimeout(new Promise<void>(() => {}), attempt.idleTimeoutMs, () => { aborted = true; }), {
      idleTimeoutMs: 1_000, maxRetries: 2, retryBaseDelayMs: 0, deadlineAt: Date.now() + 15,
    }),
    AIRequestDeadlineError,
  );
  assert.equal(aborted, true, "a request crossing the total deadline must abort its upstream operation");

  let retryAttempts = 0;
  await assert.rejects(
    runWithAIRetry(async () => { retryAttempts += 1; throw { status: 503 }; }, {
      idleTimeoutMs: 1_000, maxRetries: 2, retryBaseDelayMs: 50, deadlineAt: Date.now() + 10,
    }),
    AIRequestDeadlineError,
  );
  assert.equal(retryAttempts, 1, "a retry must not start when the remaining total time cannot cover its backoff");

  let forcedCalls = 0;
  const timedOut: IntelligenceProvider = {
    id: "timeout-test", capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn({ deadlineAt }) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, (deadlineAt || Date.now()) - Date.now() + 5)));
      throw new Error("research_total_timeout");
    },
    async generate() { forcedCalls += 1; return "{}"; },
  };
  const expired = await runIntelligenceAgentRuntime<string>({
    input, start: new Date(), generationProvider: timedOut, retrieval, systemInstruction: "system", taskPrompt: "task", finalizationInstruction: "final",
    parseFinal: () => ({ value: "unexpected", searchedAreas: [], unresolvedGaps: [], confidence: "low", itemCount: 0 }),
    budget: { maxDurationMs: 15 },
  });
  assert.equal(expired.report, null);
  assert.ok(expired.telemetry.failureCodes.includes("research_total_timeout"), "original total timeout must remain observable");
  assert.ok(expired.telemetry.turns.some((turn) => turn.invalidReason === "AGENT_TIMEOUT"));
  assert.equal(forcedCalls, 0, "forced finalization must not start after the deadline");

  console.log("intelligence research deadline tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
