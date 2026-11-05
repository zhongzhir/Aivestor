import { pool, query } from "../src/lib/db";

function requireIsolation(): { runId: string; userId: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const database = new URL(raw);
  if (database.hostname !== "127.0.0.1"
    || database.port !== "55432"
    || database.pathname !== "/aivestor_test") {
    throw new Error("result inspection refuses databases outside the isolated validation target");
  }
  const runId = process.env.INTELLIGENCE_LIVE_RUN_ID?.trim() || "";
  const userId = process.env.INTELLIGENCE_LIVE_USER_ID?.trim() || "";
  if (!runId || !userId) throw new Error("explicit run and user are required");
  return { runId, userId };
}

async function main(): Promise<void> {
  const { runId, userId } = requireIsolation();
  const run = (await query<Record<string, unknown>>(
    `SELECT id,status,retrieval_status,provider_call_state,error_code,error_message_safe,
            usage,evidence_summary,external_cost_authorization,started_at,finished_at
       FROM intelligence_runs WHERE id=$1 AND user_id=$2`,
    [runId, userId],
  ))[0];
  const attempts = await query<Record<string, unknown>>(
    `SELECT provider,capability,status,billable,request_ordinal,reserved_usd_micros,
            estimated_billable_usd_micros,actual_input_tokens,actual_output_tokens
       FROM intelligence_run_external_attempts
      WHERE run_id=$1 AND user_id=$2 ORDER BY created_at ASC`,
    [runId, userId],
  );
  const checkpoints = await query<Record<string, unknown>>(
    `SELECT stage,status,attempt,diagnostics,started_at,completed_at
       FROM intelligence_run_checkpoints
      WHERE run_id=$1 AND user_id=$2 ORDER BY started_at ASC`,
    [runId, userId],
  );
  const evidence = await query<Record<string, unknown>>(
    `SELECT item_key,canonical_url,source_name,source_tier,retrieval_provider,event_type,
            event_date,published_at,evidence_status,support_level,supports_fact_keys,exclusion_reason,
            metadata - 'content' - 'excerpt' AS metadata
       FROM intelligence_run_evidence
      WHERE run_id=$1 AND user_id=$2 ORDER BY created_at ASC`,
    [runId, userId],
  );
  const briefs = await query<Record<string, unknown>>(
    `SELECT id,item_count,coverage_start,coverage_end,generated_at,
            important_facts,trend_signals,other_items,source_list,metadata
       FROM intelligence_briefs
      WHERE run_id=$1 AND user_id=$2 ORDER BY generated_at DESC`,
    [runId, userId],
  );
  console.log(JSON.stringify({ run, attempts, checkpoints, evidence, briefs }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "result inspection failed");
  process.exitCode = 1;
}).finally(() => pool.end());
