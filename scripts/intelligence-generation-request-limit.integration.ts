import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query } from "@/lib/db";
import type { BriefResult } from "@/lib/intelligence";
import {
  createIntelligenceRun,
  processIntelligenceRunById,
} from "@/lib/intelligenceRuns";
import {
  DEEPSEEK_GENERATION_MAX_REQUESTS,
  quoteDeepSeekGenerationReservation,
} from "@/lib/intelligenceDeepSeekGenerationBudget";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const database = new URL(connectionString);
if (database.hostname !== "127.0.0.1"
  || database.port !== "55435"
  || database.pathname !== "/aivestor_core_v2_test") {
  throw new Error("generation request-limit integration refuses any database except the isolated core-v2 target");
}

const userId = "00000000-0000-4000-8000-000000000009";

async function createTask(name: string): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,$3,'["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,5,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'["融资"]'::jsonb,'{}'::jsonb)`,
    [id, userId, name],
  );
  return id;
}

function partialBrief(name: string, start: string, end: string): BriefResult {
  return {
    taskName: name,
    coverageStart: start,
    coverageEnd: end,
    generatedAt: end,
    itemCount: 0,
    importantFacts: [],
    trendSignals: [],
    otherItems: [],
    sourceList: [],
    metadata: {
      overview: "费用账本隔离回归未执行供应商调用。",
      origins: ["controlled-ledger-test"],
      generationProvider: "controlled",
      generationModel: null,
      retrieval: {
        status: "partial",
        providers: [],
        searchCandidates: 0,
        relevancePassed: 0,
        relevanceDropped: 0,
        evidence: { full: 0, partial: 0, unavailable: 0 },
        final: { facts: 0, clues: 0, trends: 0 },
        sources: [],
      },
    },
  };
}

async function main(): Promise<void> {
  await query(
    `INSERT INTO users (id,email,name,password_hash,auth_provider)
     VALUES ($1,$2,'Generation limit fixture','offline','credentials')
     ON CONFLICT (id) DO NOTHING`,
    [userId, `generation-limit-${userId}@example.test`],
  );

  const limitedTask = await createTask("单次 generation 持久授权");
  const limitedRun = await createIntelligenceRun({
    userId,
    taskId: limitedTask,
    idempotencyKey: `generation-limit:${limitedTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  assert.equal(limitedRun.external_cost_authorization.generationRequestLimit, 1);

  await processIntelligenceRunById(limitedRun.id, userId, "generation-limit-worker", {
    getGenerationAccess: async () => ({
      source: "custom",
      credentials: {
        provider: "deepseek",
        apiKey: "offline-fixture-key",
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-flash",
        usingFreeQuota: false,
      },
    }),
    generateBrief: async (_userId, _taskId, input, _now, _slot, _credentials, _runId, _defer, execution) => {
      const ledger = execution?.deepSeekGenerationDurableLedger;
      assert.ok(ledger, "worker must inject the durable generation ledger");
      const spec = quoteDeepSeekGenerationReservation(
        { system: "offline", prompt: "public fixture" },
        "deepseek-flash",
        "pipeline-fact-extraction",
        2_048,
      );
      const concurrent = await Promise.allSettled([ledger.reserve(spec), ledger.reserve(spec)]);
      const granted = concurrent.filter((item): item is PromiseFulfilledResult<string> => item.status === "fulfilled");
      const denied = concurrent.filter((item): item is PromiseRejectedResult => item.status === "rejected");
      assert.equal(granted.length, 1, "transactional row lock must allow exactly one concurrent reservation");
      assert.equal(denied.length, 1);
      assert.match(String(denied[0].reason), /PREVIOUS_RESULT_UNCERTAIN|CALL_LIMIT/);
      await ledger.complete(granted[0].value, { inputTokens: 120, outputTokens: 24 });
      await assert.rejects(ledger.reserve(spec), /CALL_LIMIT/, "completed request must not be replayed");
      return { id: "", brief: partialBrief(input.name, limitedRun.coverage_start, limitedRun.coverage_end) };
    },
  });
  const limitedStored = await query<{
    authorization: Record<string, unknown>;
    attempts: number;
    usage: { deepseekGeneration?: { maxRequests?: number } };
  }>(
    `SELECT external_cost_authorization AS authorization,usage,
            (SELECT COUNT(*)::int FROM intelligence_run_external_attempts
              WHERE run_id=$1 AND provider='deepseek' AND capability='generation') AS attempts
       FROM intelligence_runs WHERE id=$1 AND user_id=$2`,
    [limitedRun.id, userId],
  );
  assert.equal(limitedStored[0].authorization.generationRequestLimit, 1);
  assert.equal(limitedStored[0].attempts, 1);
  assert.equal(limitedStored[0].usage.deepseekGeneration?.maxRequests, 1);

  const legacyTask = await createTask("旧 generation 授权兼容");
  const legacyRun = await createIntelligenceRun({
    userId,
    taskId: legacyTask,
    idempotencyKey: `generation-legacy:${legacyTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  await query(
    "UPDATE intelligence_runs SET external_cost_authorization=external_cost_authorization - 'generationRequestLimit' WHERE id=$1 AND user_id=$2",
    [legacyRun.id, userId],
  );
  await processIntelligenceRunById(legacyRun.id, userId, "generation-legacy-worker", {
    getGenerationAccess: async () => ({
      source: "custom",
      credentials: {
        provider: "deepseek",
        apiKey: "offline-fixture-key",
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-flash",
        usingFreeQuota: false,
      },
    }),
    generateBrief: async (_userId, _taskId, input, _now, _slot, _credentials, _runId, _defer, execution) => {
      const ledger = execution?.deepSeekGenerationDurableLedger;
      assert.ok(ledger);
      const spec = quoteDeepSeekGenerationReservation({ system: "offline", prompt: "legacy public fixture" }, "deepseek-flash");
      for (let index = 0; index < 2; index++) {
        const id = await ledger.reserve(spec);
        await ledger.complete(id, { inputTokens: 100, outputTokens: 20 });
      }
      return { id: "", brief: partialBrief(input.name, legacyRun.coverage_start, legacyRun.coverage_end) };
    },
  });
  const legacyStored = await query<{
    authorization: Record<string, unknown>;
    attempts: number;
    usage: { deepseekGeneration?: { maxRequests?: number } };
  }>(
    `SELECT external_cost_authorization AS authorization,usage,
            (SELECT COUNT(*)::int FROM intelligence_run_external_attempts
              WHERE run_id=$1 AND provider='deepseek' AND capability='generation') AS attempts
       FROM intelligence_runs WHERE id=$1 AND user_id=$2`,
    [legacyRun.id, userId],
  );
  assert.equal(Object.hasOwn(legacyStored[0].authorization, "generationRequestLimit"), false);
  assert.equal(legacyStored[0].attempts, 2);
  assert.ok(legacyStored[0].attempts < DEEPSEEK_GENERATION_MAX_REQUESTS);
  assert.equal(legacyStored[0].usage.deepseekGeneration?.maxRequests, DEEPSEEK_GENERATION_MAX_REQUESTS);

  console.log("generation request-limit integration passed: new=1, concurrent=denied, replay=denied, legacy-missing-field=compatible");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
