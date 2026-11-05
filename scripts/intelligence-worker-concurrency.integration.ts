import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const url = new URL(connectionString);
if (!(url.hostname === "127.0.0.1" && url.port === "55435" && url.pathname === "/aivestor_core_v2_test")) {
  throw new Error("concurrency test refuses every database except the dedicated core-v2 target");
}

function worker(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "scripts/run-intelligence-worker.ts",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test", INTELLIGENCE_FIXTURE_MODE: "1", INTELLIGENCE_FIXTURE_SCENARIO: "success" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
}

async function waitUntil<T>(probe: () => Promise<T | null>, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for delayed worker state");
}

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const task = await client.query<{ id: string }>("SELECT id FROM intelligence_tasks WHERE name='机器人企业资本动态周报'");
    if (!task.rows[0]) throw new Error("fixture task missing");
    const taskId = task.rows[0].id;
    const before = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM intelligence_runs WHERE task_id=$1", [taskId]);
    await client.query("UPDATE intelligence_tasks SET next_run_at=NOW()-INTERVAL '17 minutes',is_active=true WHERE id=$1", [taskId]);
    const results = await Promise.all([worker(), worker()]);
    for (const result of results) if (result.code !== 0) throw new Error(`worker failed: ${result.output}`);
    const after = await client.query<{ runs: string; briefs: string; attempts: string; evidence: string }>(
      `SELECT COUNT(DISTINCT r.id)::text AS runs,
              COUNT(DISTINCT b.id)::text AS briefs,
              MAX(r.attempt_count)::text AS attempts,
              COUNT(DISTINCT e.id)::text AS evidence
         FROM intelligence_runs r
         LEFT JOIN intelligence_briefs b ON b.run_id=r.id
         LEFT JOIN intelligence_run_evidence e ON e.run_id=r.id
        WHERE r.task_id=$1`,
      [taskId]
    );
    const addedRuns = Number(after.rows[0].runs) - Number(before.rows[0].count);
    if (addedRuns !== 1) throw new Error(`expected one idempotent run, added ${addedRuns}`);
    if (Number(after.rows[0].briefs) !== Number(after.rows[0].runs)) throw new Error("run/brief one-to-one invariant failed");
    if (Number(after.rows[0].attempts) !== 1) throw new Error("double worker claimed the same run more than once");
    if (Number(after.rows[0].evidence) !== Number(after.rows[0].briefs)) throw new Error("fixture evidence count mismatch");

    const healthTaskId = randomUUID();
    const healthStartedAt = new Date();
    await client.query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,event_types,source_policy,next_run_at)
       VALUES ($1,'00000000-0000-4000-8000-000000000001','长研究调度健康测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
               '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,'',
               'scheduled','{"frequency":"daily","time":"08:00","timezone":"Asia/Shanghai"}'::jsonb,
               true,'[]'::jsonb,'{}'::jsonb,NOW()-INTERVAL '1 minute')`,
      [healthTaskId],
    );
    const loopChild = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "scripts/run-intelligence-worker.ts",
      "--loop",
      "--idle-ms=1000",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        INTELLIGENCE_FIXTURE_MODE: "1",
        INTELLIGENCE_FIXTURE_SCENARIO: "success",
        INTELLIGENCE_TEST_FIXTURE_DELAY_MS: "2000",
        INTELLIGENCE_TEST_SCHEDULER_INTERVAL_MS: "75",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let loopOutput = "";
    loopChild.stdout.on("data", (chunk) => { loopOutput += String(chunk); });
    loopChild.stderr.on("data", (chunk) => { loopOutput += String(chunk); });
    try {
      const duringStart = await waitUntil(async () => {
        const state = await client.query<{ status: string; last_cycle_succeeded_at: Date; last_heartbeat_at: Date }>(
          `SELECT r.status,h.last_cycle_succeeded_at,h.last_heartbeat_at
             FROM intelligence_runs r
             JOIN LATERAL (
               SELECT last_cycle_succeeded_at,last_heartbeat_at
                 FROM intelligence_scheduler_heartbeats
                WHERE started_at >= $2 ORDER BY started_at DESC LIMIT 1
             ) h ON true
            WHERE r.task_id=$1 ORDER BY r.created_at DESC LIMIT 1`,
          [healthTaskId, healthStartedAt.toISOString()],
        );
        return state.rows[0]?.status === "running" && state.rows[0].last_cycle_succeeded_at ? state.rows[0] : null;
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const duringLater = await client.query<{ status: string; last_cycle_succeeded_at: Date; last_heartbeat_at: Date }>(
        `SELECT r.status,h.last_cycle_succeeded_at,h.last_heartbeat_at
           FROM intelligence_runs r
           JOIN LATERAL (
             SELECT last_cycle_succeeded_at,last_heartbeat_at
               FROM intelligence_scheduler_heartbeats
              WHERE started_at >= $2 ORDER BY started_at DESC LIMIT 1
           ) h ON true
          WHERE r.task_id=$1 ORDER BY r.created_at DESC LIMIT 1`,
        [healthTaskId, healthStartedAt.toISOString()],
      );
      if (duringLater.rows[0]?.status !== "running") throw new Error("delayed fixture finished before scheduler health assertion");
      if (new Date(duringLater.rows[0].last_cycle_succeeded_at).getTime() <= new Date(duringStart.last_cycle_succeeded_at).getTime()) {
        throw new Error("scheduler success cycle did not advance during long research");
      }
      if (new Date(duringLater.rows[0].last_heartbeat_at).getTime() <= new Date(duringStart.last_heartbeat_at).getTime()) {
        throw new Error("worker heartbeat did not advance during long research");
      }
      await waitUntil(async () => {
        const terminal = await client.query<{ status: string }>("SELECT status FROM intelligence_runs WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1", [healthTaskId]);
        return terminal.rows[0] && !["queued", "running"].includes(terminal.rows[0].status) ? terminal.rows[0] : null;
      });
    } finally {
      loopChild.kill();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        loopChild.once("exit", () => { clearTimeout(timeout); resolve(); });
      });
      if (loopChild.exitCode && loopChild.exitCode !== 0) throw new Error(`loop worker failed: ${loopOutput}`);
    }
    console.log("intelligence worker concurrency integration passed");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
