import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createIntelligenceRun, runClaimedIntelligenceRun, type IntelligenceRunRow } from "@/lib/intelligenceRuns";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const url = new URL(connectionString);
if (!(url.hostname === "127.0.0.1" && url.port === "55435" && url.pathname === "/aivestor_core_v2_test")) {
  throw new Error("failure evidence test refuses every database except the dedicated core-v2 target");
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    INTELLIGENCE_FIXTURE_MODE: "1",
    INTELLIGENCE_FIXTURE_SCENARIO: "partial",
  });
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const task = await client.query<{ id: string; user_id: string }>(
      "SELECT id,user_id FROM intelligence_tasks WHERE is_active=true AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1",
    );
    if (!task.rows[0]) throw new Error("fixture task missing; run integration setup first");
    const unrelatedBefore = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM intelligence_run_evidence",
    );
    const created = await createIntelligenceRun({
      userId: task.rows[0].user_id,
      taskId: task.rows[0].id,
      idempotencyKey: `failure-evidence-${randomUUID()}`,
      now: new Date("2026-11-03T01:00:00.000Z"),
    });
    const workerKey = `failure-evidence-${randomUUID()}`;
    const claimed = await client.query<IntelligenceRunRow>(
      `UPDATE intelligence_runs
          SET status='running',locked_by=$1,locked_at=NOW(),attempt_count=1
        WHERE id=$2 AND user_id=$3 AND status='queued'
        RETURNING *`,
      [workerKey, created.id, created.user_id],
    );
    assert.ok(claimed.rows[0], "fixture run must be claimed exactly once");
    await runClaimedIntelligenceRun(claimed.rows[0], workerKey);

    const state = await client.query<{ status: string; retrieval_status: string; provider_diagnostics: unknown }>(
      "SELECT status,retrieval_status,provider_diagnostics FROM intelligence_runs WHERE id=$1 AND user_id=$2",
      [created.id, created.user_id],
    );
    assert.equal(state.rows[0]?.status, "partial");
    assert.equal(state.rows[0]?.retrieval_status, "partial");
    const evidence = await client.query<{
      canonical_url: string;
      evidence_status: string | null;
      exclusion_reason: string | null;
      retrieval_provider: string | null;
      support_level: string | null;
    }>(
      `SELECT canonical_url,evidence_status,exclusion_reason,retrieval_provider,support_level
         FROM intelligence_run_evidence
        WHERE run_id=$1 AND user_id=$2
        ORDER BY canonical_url`,
      [created.id, created.user_id],
    );
    assert.equal(evidence.rows.length, 2, "published evidence and failed evidence attempt must both persist");
    const unavailable = evidence.rows.find((row) => row.evidence_status === "unavailable");
    assert.ok(unavailable, "failed evidence attempt must remain discoverable");
    assert.equal(unavailable.exclusion_reason, "fixture_timeout");
    assert.equal(unavailable.retrieval_provider, "fixture-secondary");
    assert.equal(unavailable.support_level, "unknown");
    assert.match(unavailable.canonical_url, /\/unavailable$/);
    const unrelatedAfter = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM intelligence_run_evidence WHERE run_id<>$1",
      [created.id],
    );
    assert.equal(unrelatedAfter.rows[0]?.count, unrelatedBefore.rows[0]?.count, "new persistence must not backfill or rewrite historical runs");
    console.log("intelligence failure evidence integration passed");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
