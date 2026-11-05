import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query, withTransaction } from "@/lib/db";
import {
  cancelQueuedIntelligenceRunsForTask,
  createIntelligenceRun,
  claimNextIntelligenceRun,
  enqueueDueIntelligenceRuns,
  failExhaustedStaleRuns,
  processNextIntelligenceRun,
  releaseAbandonedPreCallReservations,
  renewIntelligenceRunLease,
  reservePlatformQuotaForRun,
  retryIntelligenceRun,
  runClaimedIntelligenceRun,
} from "@/lib/intelligenceRuns";
import { scheduledSlotKey } from "@/lib/intelligenceSchedule";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const url = new URL(connectionString);
if (!(url.hostname === "127.0.0.1" && url.port === "55435" && url.pathname === "/aivestor_core_v2_test")) {
  throw new Error("blocked test refuses every database except the dedicated core-v2 target");
}

async function main() {
  const userId = "00000000-0000-4000-8000-000000000001";
  const taskId = randomUUID();
  await query("UPDATE users SET api_key_encrypted='invalid-byok-ciphertext',ai_provider='deepseek' WHERE id=$1", [userId]);
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'BYOK失败不回退平台','["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [taskId, userId]
  );
  const quotaBefore = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
  const run = await createIntelligenceRun({ userId, taskId, idempotencyKey: `blocked:${taskId}` });
  process.env.SYSTEM_AI_API_KEY = "fixture-must-not-be-used";
  process.env.SYSTEM_AI_PROVIDER = "deepseek";
  await processNextIntelligenceRun("blocked-integration");
  const rows = await query<{ status: string; error_code: string; is_active: boolean; brief_count: string; reservation_count: string; tokens_used: string }>(
    `SELECT r.status,r.error_code,t.is_active,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS brief_count,
            (SELECT COUNT(*)::text FROM intelligence_quota_reservations q WHERE q.run_id=r.id) AS reservation_count,
            (SELECT tokens_used::text FROM free_quota_usage q WHERE q.user_id=r.user_id) AS tokens_used
       FROM intelligence_runs r JOIN intelligence_tasks t ON t.id=r.task_id
      WHERE r.id=$1`,
    [run.id]
  );
  assert.equal(rows[0].status, "blocked");
  assert.equal(rows[0].error_code, "generation_unavailable");
  assert.equal(rows[0].is_active, true, "额度或 BYOK 配置失败不得悄悄停用主题");
  assert.equal(rows[0].brief_count, "0");
  assert.equal(rows[0].reservation_count, "0", "BYOK 失败不得创建平台额度 reservation");
  assert.equal(rows[0].tokens_used, quotaBefore[0].tokens_used, "BYOK 失败不得扣平台额度");
  const quotaTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'额度幂等测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [quotaTaskId, userId]
  );
  const quotaRun = await createIntelligenceRun({ userId, taskId: quotaTaskId, idempotencyKey: `quota:${quotaTaskId}` });
  const quotaClaim = await claimNextIntelligenceRun("quota-consume");
  assert.equal(quotaClaim?.id, quotaRun.id);
  const beforeReservation = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
  const reservations = await Promise.all([reservePlatformQuotaForRun(quotaClaim!), reservePlatformQuotaForRun(quotaClaim!)]);
  assert.deepEqual(reservations, [true, true]);
  const afterReservation = await query<{ tokens_used: string; reservations: string }>(
    `SELECT q.tokens_used::text,
            (SELECT COUNT(*)::text FROM intelligence_quota_reservations r WHERE r.run_id=$2) AS reservations
       FROM free_quota_usage q WHERE q.user_id=$1`,
    [userId, quotaRun.id]
  );
  assert.equal(Number(afterReservation[0].tokens_used) - Number(beforeReservation[0].tokens_used), 2000, "并发 reservation 只能扣减一次固定额度");
  assert.equal(afterReservation[0].reservations, "1");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.INTELLIGENCE_FIXTURE_MODE = "1";
  process.env.INTELLIGENCE_FIXTURE_SCENARIO = "success";
  await runClaimedIntelligenceRun(quotaClaim!, "quota-consume");
  const consumed = await query<{ status: string }>("SELECT status FROM intelligence_quota_reservations WHERE run_id=$1", [quotaRun.id]);
  assert.equal(consumed[0].status, "consumed", "已进入生成流程的 reservation 必须结算，不能永久停留 reserved");
  await query("DELETE FROM intelligence_briefs WHERE run_id=$1", [quotaRun.id]);
  await query("UPDATE intelligence_runs SET status='failed',error_code='controlled_provider_failure',finished_at=NOW() WHERE id=$1", [quotaRun.id]);
  assert.ok(await retryIntelligenceRun(userId, quotaRun.id), "真实供应商路径失败后必须可进入下一 attempt");
  const quotaRetryClaim = await claimNextIntelligenceRun("quota-retry-attempt");
  assert.equal(quotaRetryClaim?.id, quotaRun.id);
  assert.equal(quotaRetryClaim?.provider_call_state, "none", "retry 必须重置 provider 调用闸门");
  const quotaBeforeSecondAttempt = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
  assert.equal(await reservePlatformQuotaForRun(quotaRetryClaim!), true);
  const secondAttemptReserved = await query<{ tokens_used: string; reservations: string }>(
    `SELECT tokens_used::text,
            (SELECT COUNT(*)::text FROM intelligence_quota_reservations WHERE run_id=$2) AS reservations
       FROM free_quota_usage WHERE user_id=$1`,
    [userId, quotaRun.id],
  );
  assert.equal(Number(secondAttemptReserved[0].tokens_used) - Number(quotaBeforeSecondAttempt[0].tokens_used), 2000, "每次显式 retry attempt 必须单独预留额度");
  assert.equal(secondAttemptReserved[0].reservations, "2");
  await runClaimedIntelligenceRun(quotaRetryClaim!, "quota-retry-attempt");
  const retryReservations = await query<{ consumed: string }>(
    "SELECT COUNT(*) FILTER (WHERE status='consumed')::text AS consumed FROM intelligence_quota_reservations WHERE run_id=$1",
    [quotaRun.id],
  );
  assert.equal(retryReservations[0].consumed, "2", "两个实际调用 attempt 应分别结算 consumed");

  await query("UPDATE users SET api_key_encrypted=NULL WHERE id=$1", [userId]);
  const retryTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'重试审计测试','["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'["融资"]'::jsonb,'{}'::jsonb)`,
    [retryTaskId, userId],
  );
  const retryRun = await createIntelligenceRun({ userId, taskId: retryTaskId, idempotencyKey: `retry:${retryTaskId}` });
  process.env.INTELLIGENCE_FIXTURE_SCENARIO = "failed";
  await processNextIntelligenceRun("retry-failed");
  assert.ok(await retryIntelligenceRun(userId, retryRun.id));
  process.env.INTELLIGENCE_FIXTURE_SCENARIO = "success";
  await processNextIntelligenceRun("retry-success");
  const retryAudit = await query<{ status: string; attempt_count: number; attempt_history: Array<Record<string, unknown>>; briefs: string }>(
    `SELECT r.status,r.attempt_count,r.attempt_history,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs
       FROM intelligence_runs r WHERE r.id=$1`,
    [retryRun.id],
  );
  assert.equal(retryAudit[0].status, "succeeded");
  assert.equal(retryAudit[0].attempt_count, 2);
  assert.equal(retryAudit[0].briefs, "1", "同一 run 重试不得复制成果");
  const finished = retryAudit[0].attempt_history.filter((entry) => entry.event === "finished");
  assert.equal(finished.some((entry) => entry.status === "failed" && Array.isArray(entry.providerDiagnostics)), true, "失败 attempt 必须保留安全供应商诊断");
  assert.equal(finished.some((entry) => entry.status === "succeeded"), true);

  const atomicTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'原子完成测试','["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'["融资"]'::jsonb,'{}'::jsonb)`,
    [atomicTaskId, userId],
  );
  const atomicRun = await createIntelligenceRun({ userId, taskId: atomicTaskId, idempotencyKey: `atomic:${atomicTaskId}` });
  process.env.INTELLIGENCE_FIXTURE_SCENARIO = "success";
  process.env.INTELLIGENCE_TEST_FAIL_ATOMIC_COMPLETION = "after-brief";
  await processNextIntelligenceRun("atomic-failure");
  const rolledBack = await query<{ status: string; briefs: string; evidence: string }>(
    `SELECT r.status,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id) AS evidence
       FROM intelligence_runs r WHERE r.id=$1`,
    [atomicRun.id],
  );
  assert.deepEqual(rolledBack[0], { status: "failed", briefs: "0", evidence: "0" }, "完成事务中途失败不得留下孤立 brief 或 evidence");
  delete process.env.INTELLIGENCE_TEST_FAIL_ATOMIC_COMPLETION;
  assert.ok(await retryIntelligenceRun(userId, atomicRun.id));
  await processNextIntelligenceRun("atomic-retry");
  const committed = await query<{ status: string; briefs: string; evidence: string }>(
    `SELECT r.status,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id) AS evidence
       FROM intelligence_runs r WHERE r.id=$1`,
    [atomicRun.id],
  );
  assert.deepEqual(committed[0], { status: "succeeded", briefs: "1", evidence: "1" });

  for (const state of ["paused", "archived"] as const) {
    const lifecycleTaskId = randomUUID();
    await query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,event_types,source_policy)
       VALUES ($1,$2,$3,'["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
               '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
               '','manual',NULL,true,'["融资"]'::jsonb,'{}'::jsonb)`,
      [lifecycleTaskId, userId, `运行中${state}测试`],
    );
    const lifecycleRun = await createIntelligenceRun({ userId, taskId: lifecycleTaskId, idempotencyKey: `${state}:${lifecycleTaskId}` });
    const workerKey = `lifecycle-${state}`;
    const claimed = await claimNextIntelligenceRun(workerKey);
    assert.equal(claimed?.id, lifecycleRun.id);
    await query(
      state === "paused"
        ? "UPDATE intelligence_tasks SET is_active=false,next_run_at=NULL WHERE id=$1"
        : "UPDATE intelligence_tasks SET is_active=false,archived_at=NOW(),next_run_at=NULL WHERE id=$1",
      [lifecycleTaskId],
    );
    await runClaimedIntelligenceRun(claimed!, workerKey);
    const lifecycle = await query<{ status: string; briefs: string }>(
      `SELECT r.status,(SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs
         FROM intelligence_runs r WHERE r.id=$1`,
      [lifecycleRun.id],
    );
    assert.deepEqual(lifecycle[0], { status: "succeeded", briefs: "1" }, `运行中${state}后必须按不可变快照保存成果`);
    await assert.rejects(
      createIntelligenceRun({ userId, taskId: lifecycleTaskId, idempotencyKey: `${state}:new:${lifecycleTaskId}` }),
      /不存在|已归档|已暂停/,
    );
  }

  for (const state of ["paused", "archived"] as const) {
    const queuedTaskId = randomUUID();
    await query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,event_types,source_policy)
       VALUES ($1,$2,$3,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
               '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
               '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
      [queuedTaskId, userId, `排队中${state}测试`],
    );
    const queuedRun = await createIntelligenceRun({ userId, taskId: queuedTaskId, idempotencyKey: `queued-${state}:${queuedTaskId}` });
    const quotaBeforeCancel = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
    await withTransaction(async (client) => {
      await client.query(
        state === "paused"
          ? "UPDATE intelligence_tasks SET is_active=false,next_run_at=NULL WHERE id=$1 AND user_id=$2"
          : "UPDATE intelligence_tasks SET is_active=false,archived_at=NOW(),next_run_at=NULL WHERE id=$1 AND user_id=$2",
        [queuedTaskId, userId],
      );
      await cancelQueuedIntelligenceRunsForTask(userId, queuedTaskId, state === "paused" ? "task_paused" : "task_archived", client);
    });
    const cancelled = await query<{ status: string; error_code: string; reservations: string; tokens_used: string }>(
      `SELECT r.status,r.error_code,
              (SELECT COUNT(*)::text FROM intelligence_quota_reservations q WHERE q.run_id=r.id) AS reservations,
              (SELECT tokens_used::text FROM free_quota_usage q WHERE q.user_id=r.user_id) AS tokens_used
         FROM intelligence_runs r WHERE r.id=$1`,
      [queuedRun.id],
    );
    assert.deepEqual(cancelled[0], {
      status: "cancelled",
      error_code: state === "paused" ? "task_paused" : "task_archived",
      reservations: "0",
      tokens_used: quotaBeforeCancel[0].tokens_used,
    }, `排队中${state}必须原子取消且不扣额度`);
  }

  const occupiedScheduleTaskId = randomUUID();
  const occupiedSlotAt = new Date(Date.now() - 5 * 60_000);
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy,next_run_at)
     VALUES ($1,$2,'手动运行占用计划槽测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','scheduled','{"frequency":"daily","time":"08:00","timezone":"Asia/Shanghai"}'::jsonb,
             true,'[]'::jsonb,'{}'::jsonb,$3)`,
    [occupiedScheduleTaskId, userId, occupiedSlotAt.toISOString()],
  );
  const occupiedDue = await query<{ next_run_at: string }>("SELECT next_run_at FROM intelligence_tasks WHERE id=$1", [occupiedScheduleTaskId]);
  const manualActive = await createIntelligenceRun({
    userId,
    taskId: occupiedScheduleTaskId,
    idempotencyKey: scheduledSlotKey(occupiedScheduleTaskId, new Date(occupiedDue[0].next_run_at)),
  });
  const occupiedNow = new Date();
  await enqueueDueIntelligenceRuns(occupiedNow);
  const occupiedAfter = await query<{ status: string; next_run_at: string; run_count: string }>(
    `SELECT r.status,t.next_run_at,(SELECT COUNT(*)::text FROM intelligence_runs x WHERE x.task_id=t.id) AS run_count
       FROM intelligence_tasks t JOIN intelligence_runs r ON r.id=$2 WHERE t.id=$1`,
    [occupiedScheduleTaskId, manualActive.id],
  );
  assert.deepEqual(occupiedAfter[0], { status: "queued", next_run_at: occupiedDue[0].next_run_at, run_count: "1" }, "占用时不得改手动 run 或提前消费计划槽");
  await cancelQueuedIntelligenceRunsForTask(userId, occupiedScheduleTaskId, "task_paused");
  await query(
    `UPDATE intelligence_runs SET status='cancelled',finished_at=NOW(),error_code='test_cleanup'
      WHERE user_id=$1 AND task_id<>$2 AND status='queued'`,
    [userId, occupiedScheduleTaskId],
  );
  await enqueueDueIntelligenceRuns(occupiedNow);
  const scheduledAfter = await query<{ trigger_type: string; status: string; next_future: boolean }>(
    `SELECT trigger_type,status,(SELECT next_run_at > $2 FROM intelligence_tasks WHERE id=$1) AS next_future
       FROM intelligence_runs WHERE task_id=$1 AND id<>$3 ORDER BY created_at DESC LIMIT 1`,
    [occupiedScheduleTaskId, occupiedNow.toISOString(), manualActive.id],
  );
  assert.deepEqual(scheduledAfter[0], { trigger_type: "catchup", status: "queued", next_future: true });
  await cancelQueuedIntelligenceRunsForTask(userId, occupiedScheduleTaskId, "task_paused");

  const retryConflictTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'重试冲突测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [retryConflictTaskId, userId],
  );
  const failedForRetry = await createIntelligenceRun({ userId, taskId: retryConflictTaskId, idempotencyKey: `failed:${retryConflictTaskId}` });
  await query("UPDATE intelligence_runs SET status='failed',finished_at=NOW(),error_code='fixture_failed' WHERE id=$1", [failedForRetry.id]);
  const activeForRetry = await createIntelligenceRun({ userId, taskId: retryConflictTaskId, idempotencyKey: `active:${retryConflictTaskId}` });
  assert.equal(await retryIntelligenceRun(userId, failedForRetry.id), null, "已有活跃 run 时重试应返回冲突而不是 500");
  const retryConflict = await query<{ failed_status: string; active_status: string }>(
    `SELECT (SELECT status FROM intelligence_runs WHERE id=$1) AS failed_status,
            (SELECT status FROM intelligence_runs WHERE id=$2) AS active_status`,
    [failedForRetry.id, activeForRetry.id],
  );
  assert.deepEqual(retryConflict[0], { failed_status: "failed", active_status: "queued" });
  await cancelQueuedIntelligenceRunsForTask(userId, retryConflictTaskId, "task_paused");
  await query("UPDATE intelligence_tasks SET is_active=false WHERE id=$1", [retryConflictTaskId]);
  assert.equal(await retryIntelligenceRun(userId, failedForRetry.id), null, "暂停主题不得通过 API 重试旧 run");
  await query("UPDATE intelligence_tasks SET is_active=true,archived_at=NOW() WHERE id=$1", [retryConflictTaskId]);
  assert.equal(await retryIntelligenceRun(userId, failedForRetry.id), null, "归档主题不得通过 API 重试旧 run");

  const missedTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy,next_run_at)
     VALUES ($1,$2,'长期停机跳槽测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','scheduled','{"frequency":"daily","time":"08:00","timezone":"Asia/Shanghai"}'::jsonb,
             true,'[]'::jsonb,'{}'::jsonb,NOW()-INTERVAL '10 days')`,
    [missedTaskId, userId],
  );
  const schedulerNow = new Date();
  await query("UPDATE intelligence_tasks SET next_run_at=NOW()+INTERVAL '7 days' WHERE id='10000000-0000-4000-8000-000000000001'");
  await enqueueDueIntelligenceRuns(schedulerNow);
  await enqueueDueIntelligenceRuns(schedulerNow);
  const missed = await query<{ runs: string; blocked: string; next_future: boolean }>(
    `SELECT COUNT(r.id)::text AS runs,
            COUNT(r.id) FILTER (WHERE r.status='blocked' AND r.error_code='missed_window')::text AS blocked,
            BOOL_AND(t.next_run_at > $2) AS next_future
       FROM intelligence_tasks t LEFT JOIN intelligence_runs r ON r.task_id=t.id
      WHERE t.id=$1 GROUP BY t.id`,
    [missedTaskId, schedulerNow.toISOString()],
  );
  assert.deepEqual(missed[0], { runs: "1", blocked: "1", next_future: true }, "长期停机只记录一个 missed slot，不能逐日回放历史");

  const exhaustedTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'耗尽测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [exhaustedTaskId, userId],
  );
  const exhaustedRun = await createIntelligenceRun({ userId, taskId: exhaustedTaskId, idempotencyKey: `exhausted:${exhaustedTaskId}` });
  await query("UPDATE intelligence_runs SET status='running',attempt_count=max_attempts,locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1", [exhaustedRun.id]);
  assert.equal(await failExhaustedStaleRuns(new Date()), 1);
  const exhausted = await query<{ status: string; error_code: string }>("SELECT status,error_code FROM intelligence_runs WHERE id=$1", [exhaustedRun.id]);
  assert.deepEqual(exhausted[0], { status: "failed", error_code: "max_attempts_exhausted" });

  const leaseRun = await createIntelligenceRun({ userId, taskId: exhaustedTaskId, idempotencyKey: `lease:${exhaustedTaskId}` });
  await query("UPDATE intelligence_runs SET status='running',attempt_count=1,locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1", [leaseRun.id]);
  assert.equal(await renewIntelligenceRunLease(leaseRun.id, userId), true);
  const lease = await query<{ fresh: boolean }>("SELECT locked_at > NOW()-INTERVAL '1 minute' AS fresh FROM intelligence_runs WHERE id=$1", [leaseRun.id]);
  assert.equal(lease[0].fresh, true, "运行 lease 必须可续期，避免长任务被 stale reclaim");
  const duplicateIntent = await createIntelligenceRun({ userId, taskId: exhaustedTaskId, idempotencyKey: `different-client:${exhaustedTaskId}` });
  assert.equal(duplicateIntent.id, leaseRun.id, "多客户端使用不同 idempotency key 时也不得并行生成同一主题");
  await query("UPDATE intelligence_runs SET locked_by='other-worker' WHERE id=$1", [leaseRun.id]);
  const quotaBeforeLostLease = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
  process.env.INTELLIGENCE_FIXTURE_MODE = "0";
  await runClaimedIntelligenceRun({ ...leaseRun, attempt_count: 1 }, "lost-worker", {
    // Explicitly exercise the platform-quota path. The integration user starts
    // with a deliberately broken DeepSeek BYOK credential, which is correctly
    // blocked before a platform reservation and therefore cannot prove that a
    // lost lease releases a reservation.
    getGenerationAccess: async () => ({
      source: "platform",
      credentials: {
        provider: "qwen",
        model: "qwen-plus",
        apiKey: "offline-platform-fixture",
        usingFreeQuota: true,
      },
    }),
  });
  process.env.INTELLIGENCE_FIXTURE_MODE = "1";
  const lostLease = await query<{ status: string; locked_by: string; provider_call_state: string; briefs: string; reservation_status: string; tokens_used: string }>(
    `SELECT status,locked_by,provider_call_state,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs,
            (SELECT status FROM intelligence_quota_reservations q WHERE q.run_id=r.id) AS reservation_status,
            (SELECT tokens_used::text FROM free_quota_usage q WHERE q.user_id=r.user_id) AS tokens_used
       FROM intelligence_runs r WHERE id=$1`,
    [leaseRun.id],
  );
  assert.deepEqual(lostLease[0], {
    status: "running",
    locked_by: "other-worker",
    provider_call_state: "none",
    briefs: "0",
    reservation_status: "released",
    tokens_used: quotaBeforeLostLease[0].tokens_used,
  }, "供应商调用前失去 lease 必须零调用、释放额度且不覆盖新 owner 状态");
  await query("UPDATE intelligence_runs SET status='failed',locked_at=NULL,locked_by=NULL,finished_at=NOW() WHERE id=$1", [leaseRun.id]);
  const recoveredDuplicateIntent = await createIntelligenceRun({ userId, taskId: exhaustedTaskId, idempotencyKey: `different-client:${exhaustedTaskId}` });
  assert.equal(recoveredDuplicateIntent.id, leaseRun.id, "冲突请求键必须持久映射；原 run 结束后重放也不得新建第二次运行");

  const preCallCrashTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'调用前崩溃额度释放测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [preCallCrashTaskId, userId],
  );
  const preCallCrashRun = await createIntelligenceRun({ userId, taskId: preCallCrashTaskId, idempotencyKey: `pre-call-crash:${preCallCrashTaskId}` });
  const preCallCrashClaim = await claimNextIntelligenceRun("pre-call-owner");
  assert.equal(preCallCrashClaim?.id, preCallCrashRun.id);
  const quotaBeforePreCallCrash = await query<{ tokens_used: string }>("SELECT tokens_used::text FROM free_quota_usage WHERE user_id=$1", [userId]);
  assert.equal(await reservePlatformQuotaForRun(preCallCrashClaim!), true);
  await query("UPDATE intelligence_runs SET locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1", [preCallCrashRun.id]);
  assert.equal(await releaseAbandonedPreCallReservations(), 1, "陈旧的调用前 owner 与 reservation 必须在同一事务中撤销");
  process.env.INTELLIGENCE_FIXTURE_MODE = "0";
  await runClaimedIntelligenceRun(preCallCrashClaim!, "pre-call-owner");
  process.env.INTELLIGENCE_FIXTURE_MODE = "1";
  const oldOwnerAfterRelease = await query<{ locked_by: string | null; provider_call_state: string; briefs: string; reservation_status: string; tokens_used: string }>(
    `SELECT r.locked_by,r.provider_call_state,
            (SELECT COUNT(*)::text FROM intelligence_briefs b WHERE b.run_id=r.id) AS briefs,
            (SELECT status FROM intelligence_quota_reservations q WHERE q.run_id=r.id AND q.attempt_number=1) AS reservation_status,
            (SELECT tokens_used::text FROM free_quota_usage q WHERE q.user_id=r.user_id) AS tokens_used
       FROM intelligence_runs r WHERE r.id=$1`,
    [preCallCrashRun.id],
  );
  assert.deepEqual(oldOwnerAfterRelease[0], {
    locked_by: null,
    provider_call_state: "none",
    briefs: "0",
    reservation_status: "released",
    tokens_used: quotaBeforePreCallCrash[0].tokens_used,
  }, "退款后、重领前恢复的旧 owner 不得调用供应商、生成成果或重新占用额度");
  const reclaimedAfterCrash = await claimNextIntelligenceRun("pre-call-reclaimer");
  assert.equal(reclaimedAfterCrash?.id, preCallCrashRun.id);
  assert.equal(reclaimedAfterCrash?.attempt_count, 2);
  const preCallReleased = await query<{ reservation_status: string; tokens_used: string; provider_call_state: string }>(
    `SELECT q.status AS reservation_status,u.tokens_used::text,r.provider_call_state
       FROM intelligence_runs r
       JOIN intelligence_quota_reservations q ON q.run_id=r.id AND q.attempt_number=1
       JOIN free_quota_usage u ON u.user_id=r.user_id
      WHERE r.id=$1`,
    [preCallCrashRun.id],
  );
  assert.deepEqual(preCallReleased[0], {
    reservation_status: "released",
    tokens_used: quotaBeforePreCallCrash[0].tokens_used,
    provider_call_state: "none",
  }, "供应商调用前崩溃必须在 stale reclaim 前释放上一 attempt reservation 并退回额度");
  await query("UPDATE intelligence_runs SET status='failed',locked_at=NULL,locked_by=NULL,finished_at=NOW() WHERE id=$1", [preCallCrashRun.id]);

  const uncertainTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'外部调用不确定测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [uncertainTaskId, userId],
  );
  const uncertainRun = await createIntelligenceRun({ userId, taskId: uncertainTaskId, idempotencyKey: `uncertain:${uncertainTaskId}` });
  const uncertainClaim = await claimNextIntelligenceRun("uncertain-worker");
  assert.equal(uncertainClaim?.id, uncertainRun.id);
  assert.equal(await reservePlatformQuotaForRun(uncertainClaim!), true);
  await query(
    "UPDATE intelligence_runs SET provider_call_state='started',provider_call_started_at=NOW()-INTERVAL '21 minutes',locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1",
    [uncertainRun.id],
  );
  assert.equal(await claimNextIntelligenceRun("must-not-repeat-provider"), null, "外部调用已开始的 stale run 不得被自动重领");
  const uncertainState = await query<{ status: string; error_code: string; provider_call_state: string; reservation_status: string }>(
    `SELECT r.status,r.error_code,r.provider_call_state,q.status AS reservation_status
       FROM intelligence_runs r JOIN intelligence_quota_reservations q ON q.run_id=r.id
      WHERE r.id=$1`,
    [uncertainRun.id],
  );
  assert.deepEqual(uncertainState[0], {
    status: "blocked",
    error_code: "provider_call_uncertain",
    provider_call_state: "uncertain",
    reservation_status: "consumed",
  }, "不确定外部调用必须保守结算并等待用户决定，不能自动重复付费");

  const slowTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,'慢任务租约测试','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    [slowTaskId, userId],
  );
  const slowRun = await createIntelligenceRun({ userId, taskId: slowTaskId, idempotencyKey: `slow:${slowTaskId}` });
  const slowClaim = await claimNextIntelligenceRun("slow-worker");
  assert.equal(slowClaim?.id, slowRun.id);
  process.env.INTELLIGENCE_TEST_LEASE_INTERVAL_MS = "40";
  process.env.INTELLIGENCE_TEST_FIXTURE_DELAY_MS = "250";
  const slowStarted = new Date(slowClaim!.locked_at!).getTime();
  const slowPromise = runClaimedIntelligenceRun(slowClaim!, "slow-worker");
  await new Promise((resolve) => setTimeout(resolve, 140));
  const renewed = await query<{ locked_at: string }>("SELECT locked_at FROM intelligence_runs WHERE id=$1", [slowRun.id]);
  assert.ok(new Date(renewed[0].locked_at).getTime() > slowStarted, "长任务执行期间必须由真实 run lease timer 续期");
  await slowPromise;
  delete process.env.INTELLIGENCE_TEST_LEASE_INTERVAL_MS;
  delete process.env.INTELLIGENCE_TEST_FIXTURE_DELAY_MS;
  console.log("intelligence blocked/BYOK integration passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
