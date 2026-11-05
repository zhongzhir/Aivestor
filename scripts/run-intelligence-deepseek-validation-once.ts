import { hostname } from "node:os";
import { pool, query } from "../src/lib/db";
import {
  DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT,
  DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
} from "../src/lib/intelligenceDeepSeekGenerationBudget";
import { processIntelligenceRunById } from "../src/lib/intelligenceRuns";

function requireIsolation(): { runId: string; userId: string } {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) throw new Error("DATABASE_URL is required");
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!(["127.0.0.1", "localhost"].includes(databaseUrl.hostname)) || databaseUrl.pathname !== "/aivestor_test") {
    throw new Error("DeepSeek validation worker refuses non-loopback or non-aivestor_test databases");
  }
  const runId = process.env.INTELLIGENCE_LIVE_RUN_ID?.trim() || "";
  const userId = process.env.INTELLIGENCE_LIVE_USER_ID?.trim() || "";
  if (!runId || !userId) throw new Error("INTELLIGENCE_LIVE_RUN_ID and INTELLIGENCE_LIVE_USER_ID are required");
  return { runId, userId };
}

async function main(): Promise<void> {
  const { runId, userId } = requireIsolation();
  if (process.env.INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED !== "true") {
    throw new Error("explicit validation worker requires INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED=true");
  }
  const rows = await query<{
    status: string;
    trigger_type: string;
    external_cost_authorization: Record<string, unknown>;
  }>(
    `SELECT status,trigger_type,external_cost_authorization
       FROM intelligence_runs WHERE id=$1 AND user_id=$2`,
    [runId, userId],
  );
  const run = rows[0];
  const authorization = run?.external_cost_authorization;
  if (!run || run.status !== "queued" || run.trigger_type !== "manual") {
    throw new Error("explicit queued manual run not found");
  }
  if (authorization?.deepSeekSearch !== true
    || authorization?.deepSeekGeneration !== true
    || authorization?.generationRequestLimit !== DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT
    || authorization?.deepSeekFetch === true
    || authorization?.retrievalProviderMode !== "deepseek-only"
    || authorization?.maxUsdMicros !== DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS) {
    throw new Error("run is missing the reviewed DeepSeek-only authorization envelope");
  }
  const workerKey = `deepseek-validation:${hostname()}:${process.pid}`;
  const processed = await processIntelligenceRunById(runId, userId, workerKey);
  if (processed !== runId) throw new Error("explicit run was not claimable");
  console.log(JSON.stringify({ runId, processed: true, schedulerStarted: false }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
