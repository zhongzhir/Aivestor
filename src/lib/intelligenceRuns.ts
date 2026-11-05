import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import {
  coverageFor,
  generateBrief,
  normalizeTaskInput,
  sanitizeIntelligenceBrief,
  type BriefResult,
  type DeepSeekSearchFetchAudit,
  type IntelligenceResearchInfrastructureOptions,
  type IntelligenceTaskInput,
  type ScheduleConfig,
} from "@/lib/intelligence";
import { getGenerationAccess } from "@/lib/intelligenceGeneration";
import { INTELLIGENCE_GENERATION_ESTIMATED_TOKENS } from "@/lib/intelligenceConfig";
import { isCatchupAllowed, nextScheduledAt, scheduledSlotKey } from "@/lib/intelligenceSchedule";
import { safeIntelligenceExternalUrl } from "@/lib/intelligenceUrl";
import { isOfficialDeepSeekBaseUrl, type DeepSeekCallKind, type DeepSeekDurableAttemptLedger } from "@/lib/intelligenceDeepSeekAdapter";
import {
  DEEPSEEK_GENERATION_MAX_INPUT_TOKENS,
  DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
  DEEPSEEK_GENERATION_MAX_REQUESTS,
  DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID,
  DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT,
  DEEPSEEK_SEARCH_REQUEST_USD_MICROS,
  DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
  canonicalDeepSeekGenerationModel,
  estimateDeepSeekGenerationUsdMicros,
  quoteDeepSeekGenerationUsdMicros,
  type DeepSeekGenerationDurableLedger,
  type DeepSeekGenerationFailureDiagnostic,
  type DeepSeekGenerationReservationSpec,
  type DeepSeekGenerationUsage,
} from "@/lib/intelligenceDeepSeekGenerationBudget";
import type {
  IntelligencePipelineCheckpoint,
  IntelligencePipelineCheckpointStatus,
  IntelligencePipelineEvidence,
  IntelligencePipelineStage,
  IntelligencePipelineStore,
} from "@/lib/intelligencePipeline";

export type IntelligenceRunTrigger = "manual" | "scheduled" | "catchup" | "retry";
export type IntelligenceRunStatus = "queued" | "running" | "succeeded" | "partial" | "no_new_items" | "failed" | "blocked" | "cancelled";

export interface IntelligenceRunRow {
  id: string;
  task_id: string;
  user_id: string;
  trigger_type: IntelligenceRunTrigger;
  status: IntelligenceRunStatus;
  idempotency_key: string;
  config_version: number;
  config_snapshot: IntelligenceTaskSnapshot;
  external_cost_authorization: {
    deepSeekSearch?: boolean;
    deepSeekFetch?: boolean;
    deepSeekGeneration?: boolean;
    generationRequestLimit?: number;
    maxUsdMicros?: number;
    retrievalProviderMode?: "default" | "deepseek-only";
  };
  scheduled_for: string | null;
  coverage_start: string;
  coverage_end: string;
  attempt_count: number;
  max_attempts: number;
  attempt_history: unknown[];
  locked_at: string | null;
  locked_by: string | null;
  provider_call_state: "none" | "started" | "completed" | "uncertain";
  provider_call_started_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  retrieval_status: "success" | "partial" | "failed" | "unknown" | null;
  provider_diagnostics: unknown[];
  evidence_summary: Record<string, unknown>;
  usage: Record<string, unknown>;
  error_code: string | null;
  error_message_safe: string | null;
  created_at: string;
  updated_at: string;
}

export type IntelligenceTaskSnapshot = IntelligenceTaskInput & {
  taskId: string;
  configVersion: number;
  eventTypes: string[];
  sourcePolicy: Record<string, unknown>;
};

export function nextRunAfterDueSlot(
  schedule: ScheduleConfig,
  scheduledFor: Date,
  now: Date,
  catchupAllowed: boolean,
): Date {
  // 超过补跑窗口时只记录这一次 missed slot，并直接跳到当前时间之后；
  // 不逐槽回放暂停期间的历史，也不会为历史槽触发付费调用。
  return nextScheduledAt(schedule, catchupAllowed ? scheduledFor : now);
}

interface IntelligenceTaskRow {
  id: string;
  user_id: string;
  name: string;
  original_request: string | null;
  topics: unknown;
  entities: unknown;
  keywords: unknown;
  regions: unknown;
  include_requirements: unknown;
  exclude_requirements: unknown;
  max_items: number;
  lookback_period: unknown;
  output_instructions: string;
  execution_mode: "manual" | "scheduled";
  schedule_config: ScheduleConfig | null;
  is_active: boolean;
  config_version: number;
  event_types: unknown;
  source_policy: unknown;
  next_run_at: string | null;
  archived_at: string | null;
}

const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function taskInputFromRow(task: IntelligenceTaskRow): IntelligenceTaskInput {
  return normalizeTaskInput({
    name: task.name,
    originalRequest: task.original_request || undefined,
    topics: task.topics,
    entities: task.entities,
    keywords: task.keywords,
    regions: task.regions,
    includeRequirements: task.include_requirements,
    excludeRequirements: task.exclude_requirements,
    maxItems: task.max_items,
    lookbackPeriod: task.lookback_period,
    outputInstructions: task.output_instructions,
    executionMode: task.execution_mode,
    scheduleConfig: task.schedule_config,
    isActive: task.is_active,
    eventTypes: asStrings(task.event_types),
    sourcePolicy: asObject(task.source_policy),
  });
}

export function snapshotTask(task: IntelligenceTaskRow): IntelligenceTaskSnapshot {
  return {
    ...taskInputFromRow(task),
    taskId: task.id,
    configVersion: task.config_version,
    eventTypes: asStrings(task.event_types),
    sourcePolicy: asObject(task.source_policy),
  };
}

async function loadOwnedTask(userId: string, taskId: string): Promise<IntelligenceTaskRow | null> {
  const rows = await query<IntelligenceTaskRow>(
    `SELECT id,user_id,name,original_request,topics,entities,keywords,regions,include_requirements,
            exclude_requirements,max_items,lookback_period,output_instructions,
            execution_mode,schedule_config,is_active,config_version,event_types,
            source_policy,next_run_at,archived_at
       FROM intelligence_tasks
      WHERE id = $1 AND user_id = $2`,
    [taskId, userId]
  );
  return rows[0] ?? null;
}

export type IntelligenceRunCreateDisposition = "created" | "same_intent" | "blocked_by_active_run";

export function publicIntelligenceRun(run: IntelligenceRunRow): Omit<IntelligenceRunRow, "locked_by"> {
  const safe: Partial<IntelligenceRunRow> = { ...run };
  delete safe.locked_by;
  return {
    ...safe as Omit<IntelligenceRunRow, "locked_by">,
    attempt_history: Array.isArray(run.attempt_history)
      ? run.attempt_history.map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
          const publicEntry = { ...entry } as Record<string, unknown>;
          delete publicEntry.worker;
          return publicEntry;
        })
      : [],
  };
}

export async function createIntelligenceRunWithDisposition(input: {
  userId: string;
  taskId: string;
  idempotencyKey: string;
  triggerType?: IntelligenceRunTrigger;
  scheduledFor?: Date | null;
  now?: Date;
  authorizeDeepSeekSearch?: boolean;
  authorizeDeepSeekGeneration?: boolean;
  maxExternalCostUsdMicros?: number;
  retrievalProviderMode?: "default" | "deepseek-only";
}): Promise<{ run: IntelligenceRunRow; disposition: IntelligenceRunCreateDisposition }> {
  const rawIdempotencyKey = input.idempotencyKey.trim();
  if (!rawIdempotencyKey) throw new Error("idempotency key is required");
  const triggerType = input.triggerType ?? "manual";
  // 手动请求与 scheduler slot 分属不同命名空间；用户不能用形似
  // scheduled:<task>:<time> 的 key 抢占或提前消费计划槽。
  const idempotencyKey = triggerType === "manual"
    ? `manual-request:${rawIdempotencyKey}`.slice(0, 200)
    : rawIdempotencyKey.slice(0, 200);
  const aliased = await query<IntelligenceRunRow>(
    `SELECT r.* FROM intelligence_run_request_keys k
      JOIN intelligence_runs r ON r.id=k.run_id AND r.user_id=k.user_id
     WHERE k.task_id=$1 AND k.user_id=$2 AND k.idempotency_key=$3`,
    [input.taskId, input.userId, idempotencyKey],
  );
  if (aliased[0]) return { run: aliased[0], disposition: "same_intent" };
  const existing = await query<IntelligenceRunRow>(
    "SELECT * FROM intelligence_runs WHERE task_id = $1 AND user_id = $2 AND idempotency_key = $3",
    [input.taskId, input.userId, idempotencyKey]
  );
  if (existing[0]) return { run: existing[0], disposition: "same_intent" };

  const task = await loadOwnedTask(input.userId, input.taskId);
  if (!task || task.archived_at) throw new Error("情报主题不存在或已归档");
  if (!task.is_active) throw new Error("已暂停的情报主题不能运行");
  const now = input.now ?? new Date();
  const snapshot = snapshotTask(task);
  const coverage = coverageFor(snapshot, input.scheduledFor ?? now);
  const searchAuthorized = triggerType === "manual" && input.authorizeDeepSeekSearch === true;
  const generationAuthorized = triggerType === "manual" && input.authorizeDeepSeekGeneration === true;
  if ((searchAuthorized || generationAuthorized) && input.maxExternalCostUsdMicros !== DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS) {
    throw new Error("DeepSeek 单次运行费用上限必须明确为 USD 0.10");
  }
  if (input.retrievalProviderMode === "deepseek-only" && !searchAuthorized) {
    throw new Error("DeepSeek-only 检索需要本次 Search 授权");
  }
  const externalCostAuthorization: IntelligenceRunRow["external_cost_authorization"] = searchAuthorized || generationAuthorized
    ? {
        ...(searchAuthorized ? { deepSeekSearch: true } : {}),
        deepSeekFetch: false,
        ...(generationAuthorized ? {
          deepSeekGeneration: true,
          generationRequestLimit: DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT,
        } : {}),
        maxUsdMicros: DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
        retrievalProviderMode: input.retrievalProviderMode === "deepseek-only" ? "deepseek-only" : "default",
      }
    : {};
  try {
    const rows = await query<IntelligenceRunRow>(
      `INSERT INTO intelligence_runs
         (task_id,user_id,trigger_type,status,idempotency_key,config_version,
          config_snapshot,external_cost_authorization,scheduled_for,coverage_start,coverage_end)
       VALUES ($1,$2,$3,'queued',$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
       ON CONFLICT (task_id,idempotency_key) DO UPDATE SET id = intelligence_runs.id
       RETURNING *`,
      [input.taskId, input.userId, triggerType, idempotencyKey,
        task.config_version, JSON.stringify(snapshot), JSON.stringify(externalCostAuthorization), input.scheduledFor?.toISOString() ?? null,
        coverage.start.toISOString(), coverage.end.toISOString()]
    );
    return { run: rows[0], disposition: "created" };
  } catch (error) {
    if ((error as { code?: string })?.code !== "23505") throw error;
    const active = await query<IntelligenceRunRow>(
      `SELECT * FROM intelligence_runs
        WHERE task_id=$1 AND user_id=$2 AND status IN ('queued','running')
        ORDER BY created_at ASC LIMIT 1`,
      [input.taskId, input.userId],
    );
    if (active[0]) {
      if (triggerType !== "manual") {
        return { run: active[0], disposition: "blocked_by_active_run" };
      }
      await query(
        `INSERT INTO intelligence_run_request_keys (task_id,user_id,idempotency_key,run_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (task_id,idempotency_key) DO NOTHING`,
        [input.taskId, input.userId, idempotencyKey, active[0].id],
      );
      const mapped = await query<IntelligenceRunRow>(
        `SELECT r.* FROM intelligence_run_request_keys k
          JOIN intelligence_runs r ON r.id=k.run_id AND r.user_id=k.user_id
         WHERE k.task_id=$1 AND k.user_id=$2 AND k.idempotency_key=$3`,
        [input.taskId, input.userId, idempotencyKey],
      );
      return {
        run: mapped[0] ?? active[0],
        disposition: active[0].idempotency_key === idempotencyKey ? "same_intent" : "blocked_by_active_run",
      };
    }
    throw error;
  }
}

export async function createIntelligenceRun(input: Parameters<typeof createIntelligenceRunWithDisposition>[0]): Promise<IntelligenceRunRow> {
  const result = await createIntelligenceRunWithDisposition(input);
  return result.run;
}

export async function cancelQueuedIntelligenceRunsForTask(
  userId: string,
  taskId: string,
  reason: "task_paused" | "task_archived",
  client?: PoolClient,
): Promise<number> {
  const sql = `UPDATE intelligence_runs
                  SET status='cancelled',finished_at=NOW(),locked_at=NULL,locked_by=NULL,
                      error_code=$3,error_message_safe=$4,
                      attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                        'event','cancelled-before-claim','at',NOW(),'reason',$3::text
                      )),
                      updated_at=NOW()
                WHERE task_id=$1 AND user_id=$2 AND status='queued'`;
  const params = [
    taskId,
    userId,
    reason,
    reason === "task_archived" ? "主题已归档，尚未开始的运行已取消。" : "主题已暂停，尚未开始的运行已取消。",
  ];
  if (client) return (await client.query(sql, params)).rowCount ?? 0;
  return (await query<{ id: string }>(`${sql} RETURNING id`, params)).length;
}

export async function claimNextIntelligenceRun(workerKey: string): Promise<IntelligenceRunRow | null> {
  await blockStaleUncertainProviderRuns();
  await releaseAbandonedPreCallReservations();
  await failExhaustedStaleRuns();
  const rows = await query<IntelligenceRunRow>(
    `WITH candidate AS (
       SELECT r.id FROM intelligence_runs r
       JOIN intelligence_tasks t ON t.id=r.task_id AND t.user_id=r.user_id
        WHERE (
          (r.status = 'queued' AND t.is_active=true AND t.archived_at IS NULL)
          OR (r.status = 'running' AND r.provider_call_state <> 'started' AND r.locked_at < NOW() - INTERVAL '20 minutes')
        )
          AND r.attempt_count < r.max_attempts
        ORDER BY r.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE intelligence_runs r
        SET status = 'running',
            attempt_count = attempt_count + 1,
            locked_at = NOW(),
            locked_by = $1::text,
            started_at = COALESCE(started_at, NOW()),
            finished_at = NULL,
            error_code = NULL,
            error_message_safe = NULL,
            attempt_history = attempt_history || jsonb_build_array(jsonb_build_object(
              'attempt', attempt_count + 1,
              'startedAt', NOW(),
              'worker', $1::text,
              'event', CASE WHEN status = 'running' THEN 'stale-reclaim' ELSE 'claim' END
            )),
            updated_at = NOW()
       FROM candidate
      WHERE r.id = candidate.id
     RETURNING r.*`,
    [workerKey.slice(0, 120)]
  );
  return rows[0] ?? null;
}

/**
 * 隔离验收入口：只领取调用方明确指定、明确归属的 queued run。
 * 它不会扫描队列、回收其它 run，也不会执行 scheduler。
 */
export async function claimIntelligenceRunById(
  runId: string,
  userId: string,
  workerKey: string,
): Promise<IntelligenceRunRow | null> {
  const rows = await query<IntelligenceRunRow>(
    `UPDATE intelligence_runs r
        SET status='running',attempt_count=attempt_count+1,locked_at=NOW(),locked_by=$3,
            started_at=COALESCE(started_at,NOW()),finished_at=NULL,error_code=NULL,error_message_safe=NULL,
            attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
              'attempt',attempt_count+1,'startedAt',NOW(),'worker',$3::text,'event','explicit-claim'
            )),updated_at=NOW()
       FROM intelligence_tasks t
      WHERE r.id=$1 AND r.user_id=$2 AND r.status='queued' AND r.attempt_count < r.max_attempts
        AND t.id=r.task_id AND t.user_id=r.user_id AND t.is_active=true AND t.archived_at IS NULL
      RETURNING r.*`,
    [runId, userId, workerKey.slice(0, 120)],
  );
  return rows[0] ?? null;
}

export async function releaseAbandonedPreCallReservations(now = new Date()): Promise<number> {
  return withTransaction(async (client) => {
    // 先按与额度预留相同的顺序锁 run，再锁 reservation。撤销旧 owner 与退款
    // 必须在同一事务中完成；否则旧 worker 可能在退款和 stale reclaim 之间恢复，
    // 继续进入供应商调用。
    const abandoned = await client.query<{ id: string; user_id: string; attempt_count: number }>(
      `SELECT r.id,r.user_id,r.attempt_count
         FROM intelligence_runs r
        WHERE r.status='running' AND r.provider_call_state='none'
          AND r.locked_at < $1::timestamptz - INTERVAL '20 minutes'
          AND EXISTS (
            SELECT 1 FROM intelligence_quota_reservations q
             WHERE q.run_id=r.id AND q.user_id=r.user_id
               AND q.attempt_number=r.attempt_count AND q.status='reserved'
          )
        ORDER BY r.locked_at ASC
        FOR UPDATE OF r SKIP LOCKED`,
      [now.toISOString()],
    );
    let releaseCount = 0;
    for (const run of abandoned.rows) {
      const reservation = await client.query<{ id: string; run_id: string; user_id: string; amount: number }>(
        `SELECT id,run_id,user_id,amount
           FROM intelligence_quota_reservations
          WHERE run_id=$1 AND user_id=$2 AND attempt_number=$3 AND status='reserved'
          FOR UPDATE`,
        [run.id, run.user_id, run.attempt_count],
      );
      if (!reservation.rows[0]) continue;
      const item = reservation.rows[0];
      await client.query(
        `UPDATE intelligence_runs
            SET locked_by=NULL,
                attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                  'attempt',attempt_count,'at',$1::timestamptz,'event','stale-pre-call-owner-revoked'
                )),updated_at=$1
          WHERE id=$2 AND user_id=$3 AND status='running'
            AND provider_call_state='none' AND attempt_count=$4`,
        [now.toISOString(), run.id, run.user_id, run.attempt_count],
      );
      await client.query(
        "UPDATE intelligence_quota_reservations SET status='released',updated_at=$1 WHERE id=$2 AND status='reserved'",
        [now.toISOString(), item.id],
      );
      await client.query(
        `UPDATE free_quota_usage SET tokens_used=GREATEST(0,tokens_used-$1),updated_at=$2 WHERE user_id=$3`,
        [item.amount, now.toISOString(), item.user_id],
      );
      await client.query(
        `INSERT INTO free_quota_logs (user_id,tokens_in,tokens_out,feature) VALUES ($1,$2,0,$3)`,
        [item.user_id, -item.amount, `intelligence-release:${item.run_id}`.slice(0, 50)],
      );
      await client.query(
        `UPDATE intelligence_runs
            SET usage=usage || jsonb_build_object('platformTokensReserved',$1::int,'reservationStatus','released'),updated_at=$2
          WHERE id=$3 AND user_id=$4`,
        [item.amount, now.toISOString(), item.run_id, item.user_id],
      );
      releaseCount += 1;
    }
    return releaseCount;
  });
}

export async function renewIntelligenceRunLease(runId: string, userId: string, workerKey?: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE intelligence_runs SET locked_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND status='running'
        AND ($3::text IS NULL OR locked_by=$3::text)
      RETURNING id`,
    [runId, userId, workerKey?.slice(0, 120) ?? null],
  );
  return !!rows[0];
}

export async function failExhaustedStaleRuns(now = new Date()): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE intelligence_runs
        SET status='failed',finished_at=$1,locked_at=NULL,locked_by=NULL,
            error_code='max_attempts_exhausted',
            error_message_safe='运行在达到最大尝试次数后中断，未自动再次调用外部服务。',
            attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
              'attempt',attempt_count,'finishedAt',$1::timestamptz,'event','exhausted-stale','code','max_attempts_exhausted'
            )),updated_at=$1
      WHERE status='running' AND provider_call_state <> 'started' AND attempt_count >= max_attempts
        AND locked_at < $1::timestamptz - INTERVAL '20 minutes'
      RETURNING id`,
    [now.toISOString()],
  );
  return rows.length;
}

export async function blockStaleUncertainProviderRuns(now = new Date()): Promise<number> {
  return withTransaction(async (client) => {
    // A DeepSeek-only search response is settled in the per-call ledger before
    // its candidate checkpoint is written. If the worker dies immediately
    // afterwards, there is no in-flight external call to replay: reset only
    // that narrowly proven state so the next owner can resume from evidence.
    // Facts-stage running/uncertain checkpoints remain blocked because a model
    // response may have completed without reaching the checkpoint.
    await client.query(
      `UPDATE intelligence_runs r
          SET provider_call_state='none',provider_call_started_at=NULL,updated_at=$1,
              attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                'attempt',attempt_count,'at',$1::timestamptz,'event','checkpoint-recovery-eligible'
              ))
        WHERE r.status='running' AND r.provider_call_state='started'
          AND r.locked_at < $1::timestamptz - INTERVAL '20 minutes'
          AND r.external_cost_authorization->>'retrievalProviderMode'='deepseek-only'
          AND EXISTS (
            SELECT 1 FROM intelligence_run_checkpoints c
             WHERE c.run_id=r.id AND c.user_id=r.user_id AND c.stage='retrieval'
               AND c.status IN ('running','partial','completed')
          )
          AND EXISTS (
            SELECT 1 FROM intelligence_run_evidence e
             WHERE e.run_id=r.id AND e.user_id=r.user_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM intelligence_run_external_attempts a
             WHERE a.run_id=r.id AND a.user_id=r.user_id AND a.status='reserved'
          )
          AND NOT EXISTS (
            SELECT 1 FROM intelligence_run_checkpoints c
             WHERE c.run_id=r.id AND c.user_id=r.user_id AND c.stage='facts'
               AND c.status IN ('running','uncertain')
          )`,
      [now.toISOString()],
    );
    const blocked = await client.query<{ id: string; user_id: string }>(
      `UPDATE intelligence_runs
          SET status='blocked',provider_call_state='uncertain',finished_at=$1,
              locked_at=NULL,locked_by=NULL,error_code='provider_call_uncertain',
              error_message_safe='外部调用已开始但 worker 租约失效，结果状态不确定；系统不会自动重复调用。',
              attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                'attempt',attempt_count,'finishedAt',$1::timestamptz,'event','provider-call-uncertain','code','provider_call_uncertain'
              )),updated_at=$1
        WHERE status='running' AND provider_call_state='started'
          AND locked_at < $1::timestamptz - INTERVAL '20 minutes'
        RETURNING id,user_id`,
      [now.toISOString()],
    );
    if (blocked.rows.length) {
      await markUnsettledDeepSeekAttemptsUncertainInTransaction(client, blocked.rows, now);
      await client.query(
        `UPDATE intelligence_quota_reservations q SET status='consumed',updated_at=$1
          FROM intelligence_runs r
         WHERE q.run_id=r.id AND q.user_id=r.user_id AND q.status='reserved'
           AND q.attempt_number=r.attempt_count
           AND r.id = ANY($2::uuid[])`,
        [now.toISOString(), blocked.rows.map((row) => row.id)],
      );
    }
    return blocked.rows.length;
  });
}

async function markProviderCallStarted(run: IntelligenceRunRow, workerKey: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE intelligence_runs
        SET provider_call_state='started',provider_call_started_at=NOW(),locked_at=NOW(),updated_at=NOW(),
            attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
              'attempt',attempt_count,'at',NOW(),'event','provider-call-started'
            ))
      WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3
        AND provider_call_state IN ('none','uncertain')
      RETURNING id`,
    [run.id, run.user_id, workerKey.slice(0, 120)],
  );
  return !!rows[0];
}

function safeRunError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (/RUN_LEASE_LOST/.test(raw)) return { code: "lease_lost_external_state_unknown", message: "运行租约已失效；外部调用结果状态不确定，系统不会自动重复提交。" };
  if (/DEEPSEEK_GENERATION_INPUT_LIMIT_EXCEEDED|INTELLIGENCE_AGENT_CONTEXT_LIMIT_EXCEEDED/.test(raw)) return { code: "generation_input_limit", message: "研究材料超过本次模型输入上限；系统没有发起超限的模型请求。" };
  if (/DEEPSEEK_(?:TOTAL_RUN_BUDGET_EXHAUSTED|GENERATION_CALL_LIMIT|SEARCH_BUDGET_EXHAUSTED|FETCH_BUDGET_EXHAUSTED)/.test(raw)) return { code: "external_budget_exhausted", message: "本次运行已达到已授权的外部调用或费用上限，没有继续发起请求。" };
  if (/AI completion truncated|finish_reason=length|truncated_final_output/i.test(raw)) return { code: "generation_output_truncated", message: "模型已结束本次调用，但输出达到长度上限；系统没有发布截断成果。" };
  if (/AI_NATIVE_FINALIZATION_FAILED|AGENT_FINALIZATION_FAILED/.test(raw)) return { code: "generation_output_invalid", message: "模型调用已完成，但结果未通过简报结构校验；没有发布不完整成果。" };
  if (/INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED/.test(raw)) return { code: "retrieval_checkpoint_failed", message: "检索请求已结束，但候选来源保存失败；系统已停止后续处理，不会把空结果当作没有事件。" };
  if (/quota|额度/i.test(raw)) return { code: "quota_unavailable", message: "可用额度不足，本次没有调用模型。" };
  if (/credential|API Key|AI.*配置/i.test(raw)) return { code: "credentials_unavailable", message: "AI 配置不可用，本次没有生成简报。" };
  if (/timeout|abort/i.test(raw)) return { code: "timeout", message: "上游服务超时，可以稍后重试。" };
  if (/retrieval|检索|SEARCH_FAILED/i.test(raw)) return { code: "retrieval_failed", message: "本次检索未完成，没有覆盖结论。" };
  return { code: "run_failed", message: "本次运行未完成，可以查看诊断后重试。" };
}

export interface IntelligenceRunFailureClassification {
  status: "failed" | "blocked";
  providerCallState: "none" | "completed" | "uncertain";
  code: string;
  message: string;
  event: "failed" | "provider-call-uncertain";
}

export function classifyIntelligenceRunFailure(
  error: unknown,
  options: { providerCallStarted: boolean; durableAttemptTracking: boolean; unsettledAttempts: number },
): IntelligenceRunFailureClassification {
  const safe = safeRunError(error);
  const unknownByError = safe.code === "lease_lost_external_state_unknown";
  const externalStateUnknown = options.providerCallStarted
    && (unknownByError || !options.durableAttemptTracking || options.unsettledAttempts > 0);
  return externalStateUnknown
    ? {
        status: "blocked",
        providerCallState: "uncertain",
        code: "provider_call_uncertain",
        message: "外部调用已开始但结果状态不确定；系统不会自动重复调用。",
        event: "provider-call-uncertain",
      }
    : {
        status: "failed",
        providerCallState: options.providerCallStarted ? "completed" : "none",
        ...safe,
        event: "failed",
      };
}

async function unsettledExternalAttemptCount(runId: string, userId: string): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM intelligence_run_external_attempts
      WHERE run_id=$1 AND user_id=$2 AND status IN ('reserved','uncertain')`,
    [runId, userId],
  );
  return rows[0]?.count ?? 0;
}

export async function reservePlatformQuotaForRun(run: IntelligenceRunRow): Promise<boolean> {
  const amount = INTELLIGENCE_GENERATION_ESTIMATED_TOKENS;
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM intelligence_runs WHERE id = $1 AND user_id = $2 FOR UPDATE", [run.id, run.user_id]);
    const existing = await client.query<{ id: string; status: "reserved" | "consumed" | "released"; amount: number }>(
      "SELECT id,status,amount FROM intelligence_quota_reservations WHERE run_id = $1 AND user_id = $2 AND attempt_number=$3 FOR UPDATE",
      [run.id, run.user_id, run.attempt_count]
    );
    if (existing.rows[0]?.status === "reserved" || existing.rows[0]?.status === "consumed") return true;
    if (existing.rows[0]?.status === "released") {
      const reservedAgain = await client.query<{ user_id: string }>(
        `UPDATE free_quota_usage
            SET tokens_used = tokens_used + $1, updated_at = NOW()
          WHERE user_id = $2 AND tokens_used + $1 <= tokens_limit
          RETURNING user_id`,
        [existing.rows[0].amount, run.user_id],
      );
      if (!reservedAgain.rows[0]) return false;
      await client.query(
        "UPDATE intelligence_quota_reservations SET status='reserved',updated_at=NOW() WHERE id=$1",
        [existing.rows[0].id],
      );
      await client.query(
        `INSERT INTO free_quota_logs (user_id,tokens_in,tokens_out,feature)
         VALUES ($1,$2,0,$3)`,
        [run.user_id, existing.rows[0].amount, `intelligence-run:${run.id}`.slice(0, 50)],
      );
      return true;
    }
    const reserved = await client.query<{ user_id: string }>(
      `UPDATE free_quota_usage
          SET tokens_used = tokens_used + $1, updated_at = NOW()
        WHERE user_id = $2 AND tokens_used + $1 <= tokens_limit
        RETURNING user_id`,
      [amount, run.user_id]
    );
    if (!reserved.rows[0]) return false;
    const reservationId = randomUUID();
    await client.query(
      `INSERT INTO intelligence_quota_reservations (id,run_id,user_id,attempt_number,amount,status)
       VALUES ($1,$2,$3,$4,$5,'reserved')`,
      [reservationId, run.id, run.user_id, run.attempt_count, amount]
    );
    await client.query(
      `INSERT INTO free_quota_logs (user_id,tokens_in,tokens_out,feature)
       VALUES ($1,$2,0,$3)`,
      [run.user_id, amount, `intelligence-run:${run.id}`.slice(0, 50)]
    );
    return true;
  });
}

function retrievalFromBrief(brief: BriefResult): {
  status: "success" | "partial" | "failed" | "unknown";
  providers: unknown[];
  evidence: Record<string, unknown>;
  coverageConclusion: "verified_no_matching_items" | "items_found" | "insufficient_evidence" | null;
  sources: Array<{
    url: string;
    title: string;
    source: string;
    sourceTier: string | null;
    provider: string | null;
    publishedAt: string | null;
    fetchedAt: string | null;
    evidenceStatus: "full" | "partial" | "unavailable" | null;
    exclusionReason: string | null;
  }>;
} {
  const metadata = asObject(brief.metadata);
  const retrieval = asObject(metadata.retrieval);
  const rawStatus = retrieval.status;
  const status = rawStatus === "success" || rawStatus === "partial" || rawStatus === "failed" ? rawStatus : "unknown";
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources.flatMap((raw) => {
    const source = asObject(raw);
    const url = safeIntelligenceExternalUrl(typeof source.url === "string" ? source.url : null);
    if (!url) return [];
    const evidenceStatus: "full" | "partial" | "unavailable" | null = source.evidenceStatus === "full" || source.evidenceStatus === "partial" || source.evidenceStatus === "unavailable" ? source.evidenceStatus : null;
    const exclusionReason = typeof source.exclusionReason === "string" && /^[a-z][a-z0-9_]{0,79}$/i.test(source.exclusionReason)
      ? source.exclusionReason.toLowerCase()
      : null;
    return [{
      url,
      title: String(source.title ?? "").slice(0, 500),
      source: String(source.source ?? "联网来源").slice(0, 200),
      sourceTier: typeof source.sourceTier === "string" ? source.sourceTier.slice(0, 10) : null,
      provider: typeof source.provider === "string" ? source.provider.slice(0, 120) : null,
      publishedAt: typeof source.publishedAt === "string" ? source.publishedAt : null,
      fetchedAt: typeof source.fetchedAt === "string" ? source.fetchedAt : null,
      evidenceStatus,
      exclusionReason,
    }];
  }) : [];
  return {
    status,
    providers: Array.isArray(retrieval.providers) ? retrieval.providers : [],
    evidence: asObject(retrieval.evidence),
    coverageConclusion: retrieval.coverageConclusion === "verified_no_matching_items"
      || retrieval.coverageConclusion === "items_found"
      || retrieval.coverageConclusion === "insufficient_evidence"
      ? retrieval.coverageConclusion
      : null,
    sources,
  };
}

function safeDeepSeekAudit(audit: DeepSeekSearchFetchAudit): DeepSeekSearchFetchAudit {
  const nonNegative = (value: number) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  return {
    provider: "deepseek-web",
    credentialSource: audit.credentialSource,
    featureEnabled: audit.featureEnabled === true,
    singleRunSearchAuthorized: audit.singleRunSearchAuthorized === true,
    singleRunFetchAuthorized: audit.singleRunFetchAuthorized === true,
    enabled: audit.enabled === true,
    fetchMode: audit.fetchMode === "fallback" || audit.fetchMode === "prefer" ? audit.fetchMode : "off",
    ...(audit.blockReason ? { blockReason: audit.blockReason } : {}),
    usage: {
      searchAttempts: nonNegative(audit.usage.searchAttempts),
      fetchAttempts: nonNegative(audit.usage.fetchAttempts),
      searchReserved: nonNegative(audit.usage.searchReserved),
      searchCompleted: nonNegative(audit.usage.searchCompleted),
      searchFailed: nonNegative(audit.usage.searchFailed),
      searchUncertain: nonNegative(audit.usage.searchUncertain),
      fetchReserved: nonNegative(audit.usage.fetchReserved),
      fetchCompleted: nonNegative(audit.usage.fetchCompleted),
      fetchFailed: nonNegative(audit.usage.fetchFailed),
      fetchUncertain: nonNegative(audit.usage.fetchUncertain),
      billableSearch: nonNegative(audit.usage.billableSearch),
      billableFetch: nonNegative(audit.usage.billableFetch),
      uncertain: nonNegative(audit.usage.uncertain),
      reservedUsdMicros: nonNegative(audit.usage.reservedUsdMicros),
      estimatedBillableUsdMicros: nonNegative(audit.usage.estimatedBillableUsdMicros),
    },
  };
}

interface DeepSeekAttemptAggregate {
  search_attempts: number;
  fetch_attempts: number;
  search_reserved: number;
  search_completed: number;
  search_failed: number;
  search_uncertain: number;
  fetch_reserved: number;
  fetch_completed: number;
  fetch_failed: number;
  fetch_uncertain: number;
  billable_search: number;
  billable_fetch: number;
  reserved_usd_micros: number;
  estimated_billable_usd_micros: number;
}

async function refreshDurableDeepSeekAudit(client: PoolClient, runId: string, userId: string): Promise<void> {
  const aggregated = await client.query<DeepSeekAttemptAggregate>(
    `SELECT
       COUNT(*) FILTER (WHERE capability='search')::int AS search_attempts,
       COUNT(*) FILTER (WHERE capability='fetch')::int AS fetch_attempts,
       COUNT(*) FILTER (WHERE capability='search' AND status='reserved')::int AS search_reserved,
       COUNT(*) FILTER (WHERE capability='search' AND status='completed')::int AS search_completed,
       COUNT(*) FILTER (WHERE capability='search' AND status='failed')::int AS search_failed,
       COUNT(*) FILTER (WHERE capability='search' AND status='uncertain')::int AS search_uncertain,
       COUNT(*) FILTER (WHERE capability='fetch' AND status='reserved')::int AS fetch_reserved,
       COUNT(*) FILTER (WHERE capability='fetch' AND status='completed')::int AS fetch_completed,
       COUNT(*) FILTER (WHERE capability='fetch' AND status='failed')::int AS fetch_failed,
       COUNT(*) FILTER (WHERE capability='fetch' AND status='uncertain')::int AS fetch_uncertain,
       COUNT(*) FILTER (WHERE capability='search' AND billable=true)::int AS billable_search,
       COUNT(*) FILTER (WHERE capability='fetch' AND billable=true)::int AS billable_fetch,
       COALESCE(SUM(reserved_usd_micros),0)::int AS reserved_usd_micros,
       COALESCE(SUM(estimated_billable_usd_micros),0)::int AS estimated_billable_usd_micros
     FROM intelligence_run_external_attempts
     WHERE run_id=$1 AND user_id=$2 AND provider='deepseek-web' AND capability IN ('search','fetch')`,
    [runId, userId],
  );
  const row = aggregated.rows[0];
  const audit: DeepSeekSearchFetchAudit = {
    provider: "deepseek-web",
    credentialSource: "byok",
    featureEnabled: true,
    singleRunSearchAuthorized: row.search_attempts > 0,
    singleRunFetchAuthorized: row.fetch_attempts > 0,
    enabled: row.search_attempts + row.fetch_attempts > 0,
    fetchMode: "off",
    usage: {
      searchAttempts: row.search_attempts,
      fetchAttempts: row.fetch_attempts,
      searchReserved: row.search_reserved,
      searchCompleted: row.search_completed,
      searchFailed: row.search_failed,
      searchUncertain: row.search_uncertain,
      fetchReserved: row.fetch_reserved,
      fetchCompleted: row.fetch_completed,
      fetchFailed: row.fetch_failed,
      fetchUncertain: row.fetch_uncertain,
      billableSearch: row.billable_search,
      billableFetch: row.billable_fetch,
      uncertain: row.search_uncertain + row.fetch_uncertain,
      reservedUsdMicros: row.reserved_usd_micros,
      estimatedBillableUsdMicros: row.estimated_billable_usd_micros,
    },
  };
  await client.query(
    `UPDATE intelligence_runs
        SET usage=usage || jsonb_build_object('deepseekSearchFetch',$1::jsonb),updated_at=NOW()
      WHERE id=$2 AND user_id=$3`,
    [JSON.stringify(audit), runId, userId],
  );
}

interface DeepSeekGenerationAttemptAggregate {
  attempts: number;
  reserved: number;
  completed: number;
  failed: number;
  uncertain: number;
  reserved_usd_micros: number;
  estimated_billable_usd_micros: number;
  model: string | null;
  price_snapshot_id: string | null;
}

async function refreshDurableDeepSeekGenerationAudit(client: PoolClient, runId: string, userId: string): Promise<void> {
  const authorizationResult = await client.query<{ external_cost_authorization: Record<string, unknown> }>(
    "SELECT external_cost_authorization FROM intelligence_runs WHERE id=$1 AND user_id=$2",
    [runId, userId],
  );
  let authorizedMaxRequests = 0;
  try {
    authorizedMaxRequests = authorizedDeepSeekGenerationRequestLimit(
      authorizationResult.rows[0]?.external_cost_authorization ?? {},
    );
  } catch {
    // Settlement must remain possible after a reservation even if a row was
    // tampered with. Audit the malformed envelope as zero rather than showing
    // the broader historical ceiling.
    authorizedMaxRequests = 0;
  }
  const result = await client.query<DeepSeekGenerationAttemptAggregate>(
    `SELECT COUNT(*)::int AS attempts,
            COUNT(*) FILTER (WHERE status='reserved')::int AS reserved,
            COUNT(*) FILTER (WHERE status='completed')::int AS completed,
            COUNT(*) FILTER (WHERE status='failed')::int AS failed,
            COUNT(*) FILTER (WHERE status='uncertain')::int AS uncertain,
            COALESCE(SUM(reserved_usd_micros),0)::int AS reserved_usd_micros,
            COALESCE(SUM(estimated_billable_usd_micros),0)::int AS estimated_billable_usd_micros,
            MAX(model) AS model,MAX(price_snapshot_id) AS price_snapshot_id
       FROM intelligence_run_external_attempts
      WHERE run_id=$1 AND user_id=$2 AND provider='deepseek' AND capability='generation'`,
    [runId, userId],
  );
  const row = result.rows[0];
  await client.query(
    `UPDATE intelligence_runs
        SET usage=usage || jsonb_build_object('deepseekGeneration',$1::jsonb),updated_at=NOW()
      WHERE id=$2 AND user_id=$3`,
    [JSON.stringify({
      provider: "deepseek",
      model: row.model,
      priceSnapshotId: row.price_snapshot_id,
      attempts: row.attempts,
      reserved: row.reserved,
      completed: row.completed,
      failed: row.failed,
      uncertain: row.uncertain,
      reservedUsdMicros: row.reserved_usd_micros,
      estimatedBillableUsdMicros: row.estimated_billable_usd_micros,
      maxRequests: authorizedMaxRequests,
      maxInputTokensPerRequest: DEEPSEEK_GENERATION_MAX_INPUT_TOKENS,
      maxOutputTokensPerRequest: DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
      totalRunBudgetUsdMicros: DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
    }), runId, userId],
  );
}

async function reservedExternalCostUsdMicros(client: PoolClient, runId: string, userId: string): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT COALESCE(SUM(reserved_usd_micros),0)::int AS total
       FROM intelligence_run_external_attempts WHERE run_id=$1 AND user_id=$2`,
    [runId, userId],
  );
  return result.rows[0]?.total ?? 0;
}

function durableRequestLimit(kind: DeepSeekCallKind): number {
  // 下一次真实验收固定为最多 2 次 Search、0 次 Fetch。环境变量不得在重启时
  // 静默放大已审查的单次 run 调用上限；扩大上限必须走代码审查和新的费用授权。
  return kind === "search" ? 2 : 0;
}

function authorizedRunBudgetUsdMicros(authorization: Record<string, unknown>): number {
  const value = Number(authorization.maxUsdMicros);
  if (value !== DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS) {
    throw new Error("DEEPSEEK_RUN_BUDGET_AUTHORIZATION_REQUIRED");
  }
  return value;
}

/**
 * Missing means a historical authorization written before per-run generation
 * limits existed. Explicit but malformed values fail closed rather than
 * silently expanding the reviewed envelope.
 */
export function authorizedDeepSeekGenerationRequestLimit(authorization: Record<string, unknown>): number {
  if (!Object.prototype.hasOwnProperty.call(authorization, "generationRequestLimit")) {
    return DEEPSEEK_GENERATION_MAX_REQUESTS;
  }
  const value = authorization.generationRequestLimit;
  if (!Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > DEEPSEEK_GENERATION_MAX_REQUESTS) {
    throw new Error("DEEPSEEK_GENERATION_REQUEST_LIMIT_AUTHORIZATION_INVALID");
  }
  return Number(value);
}

export function createDeepSeekRunAttemptLedger(run: IntelligenceRunRow, workerKey: string): DeepSeekDurableAttemptLedger {
  const owner = workerKey.slice(0, 120);
  const settle = async (id: string, status: "completed" | "failed" | "uncertain", billable: boolean | null, estimatedBillableUsdMicros: number) => {
    await withTransaction(async (client) => {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM intelligence_runs
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3
          FOR UPDATE`,
        [run.id, run.user_id, owner],
      );
      if (!owned.rows[0]) throw new Error("RUN_LEASE_LOST");
      const changed = await client.query<{ id: string }>(
        `UPDATE intelligence_run_external_attempts
            SET status=$1,billable=$2,estimated_billable_usd_micros=$3,settled_at=NOW()
          WHERE id=$4 AND run_id=$5 AND user_id=$6 AND status='reserved'
          RETURNING id`,
        [status, billable, estimatedBillableUsdMicros, id, run.id, run.user_id],
      );
      if (!changed.rows[0]) throw new Error("DEEPSEEK_DURABLE_ATTEMPT_NOT_RESERVED");
      await refreshDurableDeepSeekAudit(client, run.id, run.user_id);
    });
  };
  return {
    reserve: async (kind, reservedUsdMicros) => withTransaction(async (client) => {
      if (reservedUsdMicros !== DEEPSEEK_SEARCH_REQUEST_USD_MICROS) throw new Error("DEEPSEEK_DURABLE_PRICE_SNAPSHOT_MISMATCH");
      const owned = await client.query<{ attempt_count: number; external_cost_authorization: Record<string, unknown> }>(
        `SELECT attempt_count,external_cost_authorization FROM intelligence_runs
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3
            AND provider_call_state='started'
          FOR UPDATE`,
        [run.id, run.user_id, owner],
      );
      const current = owned.rows[0];
      if (!current) throw new Error("RUN_LEASE_LOST");
      const allowed = kind === "search"
        ? current.external_cost_authorization?.deepSeekSearch === true
        : current.external_cost_authorization?.deepSeekFetch === true;
      if (!allowed) throw new Error(`DEEPSEEK_${kind.toUpperCase()}_SINGLE_RUN_AUTHORIZATION_REQUIRED`);
      const runBudgetUsdMicros = authorizedRunBudgetUsdMicros(current.external_cost_authorization);
      const count = await client.query<{ attempts: number; ordinal: number }>(
        `SELECT COUNT(*)::int AS attempts,COALESCE(MAX(request_ordinal),0)::int + 1 AS ordinal
           FROM intelligence_run_external_attempts
          WHERE run_id=$1 AND user_id=$2 AND run_attempt_number=$3 AND provider='deepseek-web' AND capability=$4`,
        [run.id, run.user_id, current.attempt_count, kind],
      );
      if (count.rows[0].attempts >= durableRequestLimit(kind)) throw new Error(`DEEPSEEK_${kind.toUpperCase()}_BUDGET_EXHAUSTED`);
      if (await reservedExternalCostUsdMicros(client, run.id, run.user_id) + reservedUsdMicros > runBudgetUsdMicros) {
        throw new Error("DEEPSEEK_TOTAL_RUN_BUDGET_EXHAUSTED");
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO intelligence_run_external_attempts
           (id,run_id,user_id,run_attempt_number,request_ordinal,provider,capability,status,reserved_usd_micros)
         VALUES ($1,$2,$3,$4,$5,'deepseek-web',$6,'reserved',$7)`,
        [id, run.id, run.user_id, current.attempt_count, count.rows[0].ordinal, kind, reservedUsdMicros],
      );
      await refreshDurableDeepSeekAudit(client, run.id, run.user_id);
      return id;
    }),
    complete: (id, billable, estimatedBillableUsdMicros) => settle(id, "completed", billable, estimatedBillableUsdMicros),
    fail: (id) => settle(id, "failed", false, 0),
    uncertain: (id) => settle(id, "uncertain", null, 0),
  };
}

export function createDeepSeekGenerationRunAttemptLedger(run: IntelligenceRunRow, workerKey: string): DeepSeekGenerationDurableLedger {
  const owner = workerKey.slice(0, 120);
  const safeFailureDiagnostic = (value?: DeepSeekGenerationFailureDiagnostic): DeepSeekGenerationFailureDiagnostic | undefined => {
    if (!value) return undefined;
    const stages = new Set<DeepSeekGenerationFailureDiagnostic["stage"]>(["request", "stream", "response_validation", "settlement"]);
    const categories = new Set<DeepSeekGenerationFailureDiagnostic["category"]>(["timeout", "aborted", "http", "connection", "truncated", "output_limit", "settlement", "unknown"]);
    if (!stages.has(value.stage) || !categories.has(value.category)) return undefined;
    const integer = (input: number, max: number) => Number.isFinite(input) ? Math.max(0, Math.min(max, Math.round(input))) : 0;
    const httpStatus = Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 400 && Number(value.httpStatus) <= 599
      ? Number(value.httpStatus)
      : undefined;
    return {
      stage: value.stage,
      category: value.category,
      elapsedMs: integer(value.elapsedMs, 15 * 60_000),
      receivedOutput: value.receivedOutput === true,
      outputChars: integer(value.outputChars, 48_001),
      usageReceived: value.usageReceived === true,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
  };
  const settle = async (
    id: string,
    status: "completed" | "uncertain",
    usage?: DeepSeekGenerationUsage,
    failureDiagnostic?: DeepSeekGenerationFailureDiagnostic,
  ) => {
    await withTransaction(async (client) => {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM intelligence_runs
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3 FOR UPDATE`,
        [run.id, run.user_id, owner],
      );
      if (!owned.rows[0]) throw new Error("RUN_LEASE_LOST");
      const current = await client.query<{
        model: string; input_token_upper_bound: number; max_output_tokens: number;
        reserved_usd_micros: number; price_snapshot_id: string; request_ordinal: number;
      }>(
        `SELECT model,input_token_upper_bound,max_output_tokens,reserved_usd_micros,price_snapshot_id,request_ordinal
           FROM intelligence_run_external_attempts
          WHERE id=$1 AND run_id=$2 AND user_id=$3 AND provider='deepseek'
            AND capability='generation' AND status='reserved' FOR UPDATE`,
        [id, run.id, run.user_id],
      );
      if (!current.rows[0]) throw new Error("DEEPSEEK_GENERATION_ATTEMPT_NOT_RESERVED");
      const row = current.rows[0];
      const spec: DeepSeekGenerationReservationSpec = {
        model: row.model,
        canonicalModel: row.model === "deepseek-v4-pro" ? "deepseek-v4-pro" : "deepseek-flash",
        inputTokenUpperBound: row.input_token_upper_bound,
        maxOutputTokens: row.max_output_tokens,
        reservedUsdMicros: row.reserved_usd_micros,
        priceSnapshotId: DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID,
        phase: "settled-attempt",
      };
      const estimated = status === "completed" ? estimateDeepSeekGenerationUsdMicros(spec, usage) : 0;
      await client.query(
        `UPDATE intelligence_run_external_attempts
            SET status=$1,billable=CASE WHEN $1='completed' THEN true ELSE NULL END,
                estimated_billable_usd_micros=$2,actual_input_tokens=$3,actual_output_tokens=$4,settled_at=NOW()
          WHERE id=$5 AND status='reserved'`,
        [status, estimated, usage?.inputTokens ?? null, usage?.outputTokens ?? null, id],
      );
      const diagnostic = status === "uncertain" ? safeFailureDiagnostic(failureDiagnostic) : undefined;
      if (diagnostic) {
        await client.query(
          `UPDATE intelligence_runs
              SET attempt_history=attempt_history || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                    'attempt',attempt_count,'at',NOW(),'event','external-call-uncertain-diagnostic',
                    'provider','deepseek','capability','generation','ordinal',$1::int,
                    'stage',$2::text,'category',$3::text,'elapsedMs',$4::int,
                    'receivedOutput',$5::boolean,'outputChars',$6::int,'usageReceived',$7::boolean,
                    'httpStatus',$8::int
                  ))),updated_at=NOW()
            WHERE id=$9 AND user_id=$10 AND status='running' AND locked_by=$11`,
          [row.request_ordinal, diagnostic.stage, diagnostic.category, diagnostic.elapsedMs,
            diagnostic.receivedOutput, diagnostic.outputChars, diagnostic.usageReceived,
            diagnostic.httpStatus ?? null, run.id, run.user_id, owner],
        );
      }
      await refreshDurableDeepSeekGenerationAudit(client, run.id, run.user_id);
    });
  };
  return {
    reserve: async (spec) => withTransaction(async (client) => {
      if (spec.priceSnapshotId !== DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID
        || spec.inputTokenUpperBound > DEEPSEEK_GENERATION_MAX_INPUT_TOKENS
        || !Number.isSafeInteger(spec.maxOutputTokens)
        || spec.maxOutputTokens <= 0
        || spec.maxOutputTokens > DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS
        || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(spec.phase)
        || spec.canonicalModel !== canonicalDeepSeekGenerationModel(spec.model)
        || spec.reservedUsdMicros !== quoteDeepSeekGenerationUsdMicros(spec.model, spec.inputTokenUpperBound, spec.maxOutputTokens)) {
        throw new Error("DEEPSEEK_GENERATION_PRICE_SNAPSHOT_MISMATCH");
      }
      const owned = await client.query<{ attempt_count: number; external_cost_authorization: Record<string, unknown> }>(
        `SELECT attempt_count,external_cost_authorization FROM intelligence_runs
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3
            AND provider_call_state='started' FOR UPDATE`,
        [run.id, run.user_id, owner],
      );
      if (!owned.rows[0]) throw new Error("RUN_LEASE_LOST");
      if (owned.rows[0].external_cost_authorization?.deepSeekGeneration !== true) {
        throw new Error("DEEPSEEK_GENERATION_SINGLE_RUN_AUTHORIZATION_REQUIRED");
      }
      const runBudgetUsdMicros = authorizedRunBudgetUsdMicros(owned.rows[0].external_cost_authorization);
      const requestLimit = authorizedDeepSeekGenerationRequestLimit(owned.rows[0].external_cost_authorization);
      const prior = await client.query<{ attempts: number; unsettled: number; ordinal: number }>(
        `SELECT COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE status IN ('reserved','uncertain'))::int AS unsettled,
                COALESCE(MAX(request_ordinal),0)::int + 1 AS ordinal
           FROM intelligence_run_external_attempts
          WHERE run_id=$1 AND user_id=$2 AND provider='deepseek' AND capability='generation'`,
        [run.id, run.user_id],
      );
      if (prior.rows[0].unsettled > 0) throw new Error("DEEPSEEK_GENERATION_PREVIOUS_RESULT_UNCERTAIN");
      if (prior.rows[0].attempts >= requestLimit) throw new Error("DEEPSEEK_GENERATION_CALL_LIMIT");
      if (await reservedExternalCostUsdMicros(client, run.id, run.user_id) + spec.reservedUsdMicros > runBudgetUsdMicros) {
        throw new Error("DEEPSEEK_TOTAL_RUN_BUDGET_EXHAUSTED");
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO intelligence_run_external_attempts
           (id,run_id,user_id,run_attempt_number,request_ordinal,provider,capability,status,
            reserved_usd_micros,model,input_token_upper_bound,max_output_tokens,price_snapshot_id)
         VALUES ($1,$2,$3,$4,$5,'deepseek','generation','reserved',$6,$7,$8,$9,$10)`,
        [id, run.id, run.user_id, owned.rows[0].attempt_count, prior.rows[0].ordinal,
          spec.reservedUsdMicros, spec.canonicalModel, spec.inputTokenUpperBound, spec.maxOutputTokens, spec.priceSnapshotId],
      );
      await client.query(
        `UPDATE intelligence_runs
            SET attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
              'attempt',attempt_count,'at',NOW(),'event','external-call-reserved',
              'provider','deepseek','capability','generation','phase',$1::text,'ordinal',$2::int
            )),updated_at=NOW()
          WHERE id=$3 AND user_id=$4 AND status='running' AND locked_by=$5`,
        [spec.phase, prior.rows[0].ordinal, run.id, run.user_id, owner],
      );
      await refreshDurableDeepSeekGenerationAudit(client, run.id, run.user_id);
      return id;
    }),
    complete: (id, usage) => settle(id, "completed", usage),
    uncertain: (id, diagnostic) => settle(id, "uncertain", undefined, diagnostic),
  };
}

async function markUnsettledDeepSeekAttemptsUncertainInTransaction(
  client: PoolClient,
  runs: Array<{ id: string; user_id: string }>,
  at: Date,
): Promise<void> {
  for (const run of runs) {
    await client.query(
      `UPDATE intelligence_run_external_attempts
          SET status='uncertain',billable=NULL,estimated_billable_usd_micros=0,settled_at=$1
        WHERE run_id=$2 AND user_id=$3 AND status='reserved'`,
      [at.toISOString(), run.id, run.user_id],
    );
    await client.query(
      `UPDATE intelligence_runs SET external_cost_authorization='{}'::jsonb,updated_at=$1
        WHERE id=$2 AND user_id=$3`,
      [at.toISOString(), run.id, run.user_id],
    );
    const anyAttempt = await client.query<{ present: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM intelligence_run_external_attempts WHERE run_id=$1 AND user_id=$2
       ) AS present`,
      [run.id, run.user_id],
    );
    if (anyAttempt.rows[0]?.present) {
      await refreshDurableDeepSeekAudit(client, run.id, run.user_id);
      await refreshDurableDeepSeekGenerationAudit(client, run.id, run.user_id);
    }
  }
}

export async function markUnsettledDeepSeekAttemptsUncertain(runId: string, userId: string, at = new Date()): Promise<void> {
  await withTransaction((client) => markUnsettledDeepSeekAttemptsUncertainInTransaction(client, [{ id: runId, user_id: userId }], at));
}

export async function recordDeepSeekSearchFetchAudit(
  run: Pick<IntelligenceRunRow, "id" | "user_id">,
  workerKey: string,
  audit: DeepSeekSearchFetchAudit,
): Promise<void> {
  const rows = await query<{ id: string }>(
    `UPDATE intelligence_runs
        SET usage=usage || jsonb_build_object('deepseekSearchFetch',$1::jsonb),updated_at=NOW()
      WHERE id=$2 AND user_id=$3 AND status='running' AND locked_by=$4
      RETURNING id`,
    [JSON.stringify(safeDeepSeekAudit(audit)), run.id, run.user_id, workerKey.slice(0, 120)],
  );
  if (!rows[0]) throw new Error("RUN_LEASE_LOST");
}

function boundedPipelineText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pipelineSourceTier(value: unknown): IntelligencePipelineEvidence["sourceTier"] {
  return value === "S" || value === "A" || value === "B" ? value : "C";
}

function pipelineEvidenceStatus(value: unknown): IntelligencePipelineEvidence["evidenceStatus"] {
  return value === "full" || value === "partial" || value === "unavailable" ? value : null;
}

/**
 * PostgreSQL-backed stage store for one claimed run. All writes are lease-gated;
 * losing the claim stops the pipeline before another external call can start.
 */
export function createIntelligencePipelineStore(
  run: Pick<IntelligenceRunRow, "id" | "user_id">,
  workerKey: string,
): IntelligencePipelineStore {
  const ownerKey = workerKey.slice(0, 120);
  return {
    async loadCheckpoint(stage: IntelligencePipelineStage): Promise<IntelligencePipelineCheckpoint | null> {
      const rows = await query<{
        stage: IntelligencePipelineStage;
        status: IntelligencePipelineCheckpointStatus;
        attempt: number;
        payload: Record<string, unknown>;
        diagnostics: Record<string, unknown>;
      }>(
        `SELECT stage,status,attempt,payload,diagnostics
           FROM intelligence_run_checkpoints
          WHERE run_id=$1 AND user_id=$2 AND stage=$3`,
        [run.id, run.user_id, stage],
      );
      const row = rows[0];
      return row ? {
        stage: row.stage,
        status: row.status,
        attempt: Number(row.attempt) || 1,
        payload: asObject(row.payload),
        diagnostics: asObject(row.diagnostics),
      } : null;
    },

    async saveCheckpoint(checkpoint): Promise<void> {
      const rows = await query<{ run_id: string }>(
        `INSERT INTO intelligence_run_checkpoints
           (run_id,user_id,stage,status,attempt,payload,diagnostics,started_at,completed_at,updated_at)
         SELECT id,user_id,$3,$4,$5,$6::jsonb,$7::jsonb,NOW(),
                CASE WHEN $4='running' THEN NULL ELSE NOW() END,NOW()
           FROM intelligence_runs
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$8
         ON CONFLICT (run_id,stage) DO UPDATE SET
           status=EXCLUDED.status,
           attempt=CASE
             WHEN EXCLUDED.status='running'
              AND intelligence_run_checkpoints.status IN ('failed','partial')
               THEN intelligence_run_checkpoints.attempt + 1
             ELSE GREATEST(intelligence_run_checkpoints.attempt,EXCLUDED.attempt)
           END,
           payload=EXCLUDED.payload,
           diagnostics=EXCLUDED.diagnostics,
           started_at=CASE WHEN EXCLUDED.status='running' THEN NOW() ELSE intelligence_run_checkpoints.started_at END,
           completed_at=CASE WHEN EXCLUDED.status='running' THEN NULL ELSE NOW() END,
           updated_at=NOW()
         WHERE intelligence_run_checkpoints.user_id=EXCLUDED.user_id
         RETURNING run_id`,
        [
          run.id,
          run.user_id,
          checkpoint.stage,
          checkpoint.status,
          checkpoint.attempt ?? 1,
          JSON.stringify(checkpoint.payload || {}),
          JSON.stringify(checkpoint.diagnostics || {}),
          ownerKey,
        ],
      );
      if (!rows[0]) throw new Error("RUN_LEASE_LOST");
    },

    async upsertEvidence(items): Promise<void> {
      for (const item of items) {
        const url = safeIntelligenceExternalUrl(item.url);
        if (!url) continue;
        const metadata = {
          title: boundedPipelineText(item.title, 400),
          query: boundedPipelineText(item.query, 500),
          snippet: boundedPipelineText(item.snippet, 1_200),
          contentExcerpt: boundedPipelineText(item.contentExcerpt, 3_500),
          failureReason: item.failureReason ? boundedPipelineText(item.failureReason, 300) : null,
          pipelineVersion: 2,
        };
        const rows = await query<{ id: string }>(
          `WITH owned_run AS (
             SELECT id,user_id FROM intelligence_runs
              WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$13
           ), existing AS (
             SELECT e.id
               FROM intelligence_run_evidence e
               JOIN owned_run r ON r.id=e.run_id AND r.user_id=e.user_id
              WHERE e.canonical_url=$4
              ORDER BY e.created_at,e.id
              LIMIT 1
              FOR UPDATE
           ), updated AS (
             UPDATE intelligence_run_evidence e SET
               source_name=$5,
               source_tier=$6,
               retrieval_provider=COALESCE($7,e.retrieval_provider),
               published_at=COALESCE($8,e.published_at),
               fetched_at=COALESCE($9,e.fetched_at),
               evidence_status=CASE
                 WHEN COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],$10::text),0)
                    > COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],e.evidence_status),0)
                   THEN $10::text ELSE COALESCE(e.evidence_status,$10::text)
               END,
               exclusion_reason=$11,
               metadata=e.metadata || $12::jsonb
              FROM existing x
             WHERE e.id=x.id
             RETURNING e.id
           ), inserted AS (
             INSERT INTO intelligence_run_evidence
               (run_id,user_id,item_key,canonical_url,source_name,source_tier,retrieval_provider,
                published_at,fetched_at,evidence_status,support_level,exclusion_reason,metadata)
             SELECT r.id,r.user_id,$3,$4,$5,$6,$7,$8,$9,$10,'unknown',$11,$12::jsonb
               FROM owned_run r
              WHERE NOT EXISTS (SELECT 1 FROM updated)
             ON CONFLICT (run_id,item_key,canonical_url) DO UPDATE SET
               source_name=EXCLUDED.source_name,
               source_tier=EXCLUDED.source_tier,
               retrieval_provider=COALESCE(EXCLUDED.retrieval_provider,intelligence_run_evidence.retrieval_provider),
               published_at=COALESCE(EXCLUDED.published_at,intelligence_run_evidence.published_at),
               fetched_at=COALESCE(EXCLUDED.fetched_at,intelligence_run_evidence.fetched_at),
               evidence_status=CASE
                 WHEN COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],EXCLUDED.evidence_status),0)
                    > COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],intelligence_run_evidence.evidence_status),0)
                   THEN EXCLUDED.evidence_status ELSE COALESCE(intelligence_run_evidence.evidence_status,EXCLUDED.evidence_status)
               END,
               exclusion_reason=EXCLUDED.exclusion_reason,
               metadata=intelligence_run_evidence.metadata || EXCLUDED.metadata
             WHERE intelligence_run_evidence.user_id=EXCLUDED.user_id
             RETURNING id
           )
           SELECT id FROM updated UNION ALL SELECT id FROM inserted`,
          [
            run.id,
            run.user_id,
            boundedPipelineText(item.itemKey, 200),
            url,
            boundedPipelineText(item.sourceName || "来源", 300),
            pipelineSourceTier(item.sourceTier),
            item.retrievalProvider ? boundedPipelineText(item.retrievalProvider, 120) : null,
            item.publishedAt || null,
            item.fetchedAt || null,
            pipelineEvidenceStatus(item.evidenceStatus),
            item.failureReason ? boundedPipelineText(item.failureReason, 300) : null,
            JSON.stringify(metadata),
            ownerKey,
          ],
        );
        if (!rows[0]) throw new Error("RUN_LEASE_LOST");
      }
    },

    async listEvidence(): Promise<IntelligencePipelineEvidence[]> {
      const rows = await query<{
        item_key: string;
        canonical_url: string;
        source_name: string;
        source_tier: string | null;
        retrieval_provider: string | null;
        published_at: string | null;
        fetched_at: string | null;
        evidence_status: string | null;
        exclusion_reason: string | null;
        metadata: Record<string, unknown>;
      }>(
        `SELECT item_key,canonical_url,source_name,source_tier,retrieval_provider,
                published_at,fetched_at,evidence_status,exclusion_reason,metadata
           FROM intelligence_run_evidence
          WHERE run_id=$1 AND user_id=$2
          ORDER BY created_at ASC,id ASC`,
        [run.id, run.user_id],
      );
      return rows.map((row) => {
        const metadata = asObject(row.metadata);
        return {
          itemKey: row.item_key,
          url: row.canonical_url,
          title: boundedPipelineText(metadata.title, 400),
          sourceName: row.source_name,
          sourceTier: pipelineSourceTier(row.source_tier),
          retrievalProvider: row.retrieval_provider,
          query: boundedPipelineText(metadata.query, 500),
          snippet: boundedPipelineText(metadata.snippet, 1_200),
          contentExcerpt: boundedPipelineText(metadata.contentExcerpt, 3_500),
          publishedAt: row.published_at,
          fetchedAt: row.fetched_at,
          evidenceStatus: pipelineEvidenceStatus(row.evidence_status),
          failureReason: row.exclusion_reason || (typeof metadata.failureReason === "string" ? boundedPipelineText(metadata.failureReason, 300) : null),
        };
      });
    },
  };
}

export function evidencePublishedAtForUrl(
  url: string,
  itemPublishedAt: string | null | undefined,
  sourceList: Array<{ url?: string | null; publishedAt?: string | null }>,
  sourceCount: number,
): string | null {
  const exact = sourceList.find((source) => source.url === url);
  if (exact) return exact.publishedAt || null;
  // 单来源旧成果可沿用 item 级发布时间；多来源缺逐源日期时保持未知，
  // 不能把一个来源的日期复制到其他 URL。
  return sourceCount === 1 ? itemPublishedAt || null : null;
}

async function completeRunAtomically(run: IntelligenceRunRow, brief: BriefResult, workerKey: string): Promise<void> {
  const storedBrief = sanitizeIntelligenceBrief(brief);
  const retrieval = retrievalFromBrief(storedBrief);
  const verifiedEvidenceCount = retrieval.sources.filter((source) => source.evidenceStatus === "full").length;
  const research = asObject(storedBrief.metadata.research);
  const factValidation = asObject(research.validation);
  const factExtractionPartial = Number(factValidation.rejectedItems || 0) > 0;
  const status: IntelligenceRunStatus = retrieval.status === "failed"
    ? "failed"
    : retrieval.status !== "success" || factExtractionPartial
      ? "partial"
      : storedBrief.itemCount === 0
        ? retrieval.coverageConclusion === "verified_no_matching_items" && verifiedEvidenceCount > 0
          ? "no_new_items"
          : "partial"
        : "succeeded";
  await withTransaction(async (client) => {
    const unsettledExternalAttempt = await client.query<{ id: string }>(
      `SELECT id FROM intelligence_run_external_attempts
        WHERE run_id=$1 AND user_id=$2 AND status='reserved'
        LIMIT 1 FOR UPDATE`,
      [run.id, run.user_id],
    );
    if (unsettledExternalAttempt.rows[0]) throw new Error("DEEPSEEK_EXTERNAL_ATTEMPT_NOT_SETTLED");
    await client.query(
      `INSERT INTO intelligence_briefs
         (task_id,user_id,task_name,coverage_start,coverage_end,generated_at,item_count,
          important_facts,trend_signals,other_items,source_list,metadata,scheduled_slot,run_id,schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,2)
       ON CONFLICT (run_id) WHERE run_id IS NOT NULL DO UPDATE SET
         task_name=EXCLUDED.task_name,coverage_start=EXCLUDED.coverage_start,
         coverage_end=EXCLUDED.coverage_end,generated_at=EXCLUDED.generated_at,
         item_count=EXCLUDED.item_count,important_facts=EXCLUDED.important_facts,
         trend_signals=EXCLUDED.trend_signals,other_items=EXCLUDED.other_items,
         source_list=EXCLUDED.source_list,metadata=EXCLUDED.metadata,schema_version=EXCLUDED.schema_version`,
      [run.task_id, run.user_id, storedBrief.taskName, storedBrief.coverageStart, storedBrief.coverageEnd,
        storedBrief.generatedAt, storedBrief.itemCount, JSON.stringify(storedBrief.importantFacts),
        JSON.stringify(storedBrief.trendSignals), JSON.stringify(storedBrief.otherItems),
        JSON.stringify(storedBrief.sourceList), JSON.stringify(storedBrief.metadata), run.scheduled_for, run.id],
    );
    if (process.env.NODE_ENV === "test" && process.env.INTELLIGENCE_TEST_FAIL_ATOMIC_COMPLETION === "after-brief") {
      throw new Error("TEST_ATOMIC_COMPLETION_FAILURE");
    }
    // Stage evidence is a durable checkpoint. Never delete it while publishing the
    // brief; terminal writes only enrich or add fact bindings.
    const retrievalSources = new Map(retrieval.sources.map((source) => [source.url, source]));
    const persistedUrls = new Set<string>();
    const upsertSourceEvidence = async (source: {
      url: string;
      sourceName: string;
      sourceTier: string | null;
      retrievalProvider: string | null;
      publishedAt: string | null;
      discoveredAt: string | null;
      fetchedAt: string | null;
      evidenceStatus: string | null;
      supportLevel: string | null;
      factKeys: string[];
      exclusionReason: string | null;
      metadata: Record<string, unknown>;
    }): Promise<void> => {
      const itemKey = `source:${createHash("sha256").update(source.url).digest("hex").slice(0, 32)}`;
      await client.query(
        `WITH existing AS (
           SELECT id
             FROM intelligence_run_evidence
            WHERE run_id=$1 AND user_id=$2 AND canonical_url=$4
            ORDER BY created_at,id
            LIMIT 1
            FOR UPDATE
         ), updated AS (
           UPDATE intelligence_run_evidence e SET
             source_name=$5,
             source_tier=COALESCE($6,e.source_tier),
             retrieval_provider=COALESCE($7,e.retrieval_provider),
             published_at=COALESCE($8,e.published_at),
             discovered_at=COALESCE($9,e.discovered_at),
             fetched_at=COALESCE($10,e.fetched_at),
             evidence_status=CASE
               WHEN COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],$11::text),0)
                  > COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],e.evidence_status),0)
                 THEN $11::text ELSE COALESCE(e.evidence_status,$11::text)
             END,
             support_level=CASE
               WHEN COALESCE(array_position(ARRAY['unknown','context','corroborating','direct']::text[],$12::text),0)
                  > COALESCE(array_position(ARRAY['unknown','context','corroborating','direct']::text[],e.support_level),0)
                 THEN $12::text ELSE COALESCE(e.support_level,$12::text)
             END,
             supports_fact_keys=(
               SELECT COALESCE(jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb)
                 FROM jsonb_array_elements_text(COALESCE(e.supports_fact_keys,'[]'::jsonb) || $13::jsonb) AS merged(value)
             ),
             exclusion_reason=$14,
             metadata=e.metadata || $15::jsonb
            FROM existing x
           WHERE e.id=x.id
           RETURNING e.id
         ), inserted AS (
           INSERT INTO intelligence_run_evidence
             (run_id,user_id,item_key,canonical_url,source_name,source_tier,retrieval_provider,
              published_at,discovered_at,fetched_at,evidence_status,support_level,
              supports_fact_keys,exclusion_reason,metadata)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM updated)
           ON CONFLICT (run_id,item_key,canonical_url) DO UPDATE SET
             source_name=EXCLUDED.source_name,
             source_tier=COALESCE(EXCLUDED.source_tier,intelligence_run_evidence.source_tier),
             retrieval_provider=COALESCE(EXCLUDED.retrieval_provider,intelligence_run_evidence.retrieval_provider),
             published_at=COALESCE(EXCLUDED.published_at,intelligence_run_evidence.published_at),
             discovered_at=COALESCE(EXCLUDED.discovered_at,intelligence_run_evidence.discovered_at),
             fetched_at=COALESCE(EXCLUDED.fetched_at,intelligence_run_evidence.fetched_at),
             evidence_status=CASE
               WHEN COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],EXCLUDED.evidence_status),0)
                  > COALESCE(array_position(ARRAY['unavailable','partial','full']::text[],intelligence_run_evidence.evidence_status),0)
                 THEN EXCLUDED.evidence_status ELSE COALESCE(intelligence_run_evidence.evidence_status,EXCLUDED.evidence_status)
             END,
             support_level=CASE
               WHEN COALESCE(array_position(ARRAY['unknown','context','corroborating','direct']::text[],EXCLUDED.support_level),0)
                  > COALESCE(array_position(ARRAY['unknown','context','corroborating','direct']::text[],intelligence_run_evidence.support_level),0)
                 THEN EXCLUDED.support_level ELSE COALESCE(intelligence_run_evidence.support_level,EXCLUDED.support_level)
             END,
             supports_fact_keys=(
               SELECT COALESCE(jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb)
                 FROM jsonb_array_elements_text(
                   COALESCE(intelligence_run_evidence.supports_fact_keys,'[]'::jsonb) || EXCLUDED.supports_fact_keys
                 ) AS merged(value)
             ),
             exclusion_reason=EXCLUDED.exclusion_reason,
             metadata=intelligence_run_evidence.metadata || EXCLUDED.metadata
           WHERE intelligence_run_evidence.user_id=EXCLUDED.user_id
           RETURNING id
         )
         SELECT id FROM updated UNION ALL SELECT id FROM inserted`,
        [run.id, run.user_id, itemKey, source.url, source.sourceName, source.sourceTier,
          source.retrievalProvider, source.publishedAt, source.discoveredAt, source.fetchedAt,
          source.evidenceStatus, source.supportLevel, JSON.stringify(source.factKeys),
          source.exclusionReason, JSON.stringify(source.metadata)],
      );
    };
    const items = [...storedBrief.importantFacts, ...storedBrief.trendSignals, ...storedBrief.otherItems];
    for (const item of items) {
      const urls = [...new Set([item.sourceUrl, ...(item.sourceUrls ?? [])].map(safeIntelligenceExternalUrl).filter((url): url is string => !!url))];
      for (const url of urls) {
        const evidencePublishedAt = evidencePublishedAtForUrl(url, item.publishedAt, storedBrief.sourceList, urls.length);
        const retrievalSource = retrievalSources.get(url);
        await upsertSourceEvidence({
          url,
          sourceName: item.source || "来源",
          sourceTier: item.sourceTier ?? null,
          retrievalProvider: retrievalSource?.provider ?? null,
          publishedAt: evidencePublishedAt,
          discoveredAt: item.discoveredAt ?? null,
          fetchedAt: item.fetchedAt ?? new Date().toISOString(),
          evidenceStatus: item.evidenceStatus ?? null,
          supportLevel: item.supportLevel ?? (item.isClue ? "unknown" : "direct"),
          factKeys: [String(item.id).slice(0, 200)],
          exclusionReason: retrievalSource?.exclusionReason ?? null,
          metadata: { retrievalTitle: retrievalSource?.title || null },
        });
        persistedUrls.add(url);
      }
    }
    for (const source of retrieval.sources) {
      if (persistedUrls.has(source.url)) continue;
      await upsertSourceEvidence({
        url: source.url,
        sourceName: source.source,
        sourceTier: source.sourceTier,
        retrievalProvider: source.provider,
        publishedAt: source.publishedAt,
        discoveredAt: null,
        fetchedAt: source.fetchedAt,
        evidenceStatus: source.evidenceStatus,
        supportLevel: "unknown",
        factKeys: [],
        exclusionReason: source.exclusionReason,
        metadata: { title: source.title, attempted: source.evidenceStatus !== null },
      });
      persistedUrls.add(source.url);
    }
    const completed = await client.query<{ id: string }>(
      `UPDATE intelligence_runs
          SET status=$1::text,retrieval_status=$2::text,provider_diagnostics=$3::jsonb,
              evidence_summary=$4::jsonb,finished_at=NOW(),locked_at=NULL,locked_by=NULL,
              provider_call_state=CASE WHEN provider_call_state='started' THEN 'completed' ELSE provider_call_state END,
              error_code=CASE WHEN $1::text='failed' THEN 'retrieval_failed' ELSE NULL END,
              error_message_safe=CASE WHEN $1::text='failed' THEN '本次检索未完成，没有覆盖结论。' ELSE NULL END,
              attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                'attempt',attempt_count,'finishedAt',NOW(),'event','finished','status',$1::text,
                'retrievalStatus',$2::text,'providerDiagnostics',$3::jsonb,'evidenceSummary',$4::jsonb
              )),updated_at=NOW()
        WHERE id=$5 AND user_id=$6 AND status='running' AND locked_by=$7
        RETURNING id`,
      [status, retrieval.status, JSON.stringify(retrieval.providers), JSON.stringify(retrieval.evidence), run.id, run.user_id, workerKey.slice(0, 120)],
    );
    if (!completed.rows[0]) throw new Error("RUN_LEASE_LOST");
    const reservation = await client.query<{ amount: number }>(
      `UPDATE intelligence_quota_reservations SET status='consumed',updated_at=NOW()
        WHERE run_id=$1 AND user_id=$2 AND attempt_number=$3 AND status='reserved' RETURNING amount`,
      [run.id, run.user_id, run.attempt_count],
    );
    if (reservation.rows[0]) {
      await client.query(
        `UPDATE intelligence_runs
            SET usage=usage || jsonb_build_object('platformTokensReserved',$1::int,'reservationStatus','consumed'),updated_at=NOW()
          WHERE id=$2 AND user_id=$3`,
        [reservation.rows[0].amount, run.id, run.user_id],
      );
    }
  });
}

async function settleQuotaReservation(run: IntelligenceRunRow, status: "consumed" | "released"): Promise<void> {
  await withTransaction(async (client) => {
    const rows = await client.query<{ amount: number }>(
      `UPDATE intelligence_quota_reservations
          SET status=$1,updated_at=NOW()
        WHERE run_id=$2 AND user_id=$3 AND attempt_number=$4 AND status='reserved'
        RETURNING amount`,
      [status, run.id, run.user_id, run.attempt_count],
    );
    if (!rows.rows[0]) return;
    if (status === "released") {
      await client.query(
        `UPDATE free_quota_usage
            SET tokens_used=GREATEST(0,tokens_used-$1),updated_at=NOW()
          WHERE user_id=$2`,
        [rows.rows[0].amount, run.user_id],
      );
      await client.query(
        `INSERT INTO free_quota_logs (user_id,tokens_in,tokens_out,feature)
         VALUES ($1,$2,0,$3)`,
        [run.user_id, -rows.rows[0].amount, `intelligence-release:${run.id}`.slice(0, 50)],
      );
    }
    await client.query(
      `UPDATE intelligence_runs
          SET usage=usage || jsonb_build_object('platformTokensReserved',$1::int,'reservationStatus',$2::text),updated_at=NOW()
        WHERE id=$3 AND user_id=$4`,
      [rows.rows[0].amount, status, run.id, run.user_id],
    );
  });
}

function fixtureBrief(run: IntelligenceRunRow): BriefResult {
  const configuredScenario = process.env.INTELLIGENCE_FIXTURE_SCENARIO || "success";
  const scenario = configuredScenario === "auto"
    ? /部分/.test(run.config_snapshot.name) ? "partial" : /失败/.test(run.config_snapshot.name) ? "failed" : /无新|空结果/.test(run.config_snapshot.name) ? "empty" : "success"
    : configuredScenario;
  const retrievalStatus = scenario === "failed" ? "failed" : scenario === "partial" ? "partial" : "success";
  const hasItem = scenario !== "empty" && scenario !== "failed";
  const verifiedEmpty = scenario === "empty";
  const item = {
    id: `fixture:${run.id}`,
    title: `${run.config_snapshot.name}：可控测试事件`,
    content: "这是隔离测试供应商返回的确定性事件，不代表真实市场结果。",
    summary: "隔离测试事件，用于验证持久成果、来源和运行状态。",
    investmentNote: "这是测试推断，不用于投资决策。",
    source: "AIVESTOR Fixture Provider",
    sourceUrl: `https://fixture.local/intelligence/${run.id}`,
    sourceUrls: [`https://fixture.local/intelligence/${run.id}`],
    publishedAt: run.coverage_end,
    eventDate: run.coverage_end,
    discoveredAt: run.coverage_end,
    fetchedAt: run.coverage_end,
    subject: run.config_snapshot.entities[0] || run.config_snapshot.topics[0] || run.config_snapshot.name,
    region: run.config_snapshot.regions[0] || null,
    kind: "fact" as const,
    sourceTier: "S" as const,
    origin: "web-search" as const,
    evidenceStatus: "full" as const,
    supportLevel: "direct" as const,
    importance: "high" as const,
    relevance: "high" as const,
    eventType: run.config_snapshot.eventTypes[0] || "重要动态",
  };
  const providers = scenario === "partial"
    ? [
        { provider: "fixture-primary", attempted: true, succeeded: true, queryCount: 1, resultCount: hasItem || verifiedEmpty ? 1 : 0, coverageCapability: "exact" as const },
        { provider: "fixture-secondary", attempted: true, succeeded: false, queryCount: 1, resultCount: 0, coverageCapability: "exact" as const, errorCode: "fixture_timeout" },
      ]
    : [{ provider: "fixture-primary", attempted: true, succeeded: retrievalStatus !== "failed", queryCount: 1, resultCount: hasItem || verifiedEmpty ? 1 : 0, coverageCapability: "exact" as const, ...(retrievalStatus === "failed" ? { errorCode: "fixture_failed" } : {}) }];
  const verifiedSource = { url: item.sourceUrl, title: item.title, source: item.source, sourceTier: item.sourceTier, provider: "fixture-primary", publishedAt: item.publishedAt, fetchedAt: item.fetchedAt, evidenceStatus: "full" as const, exclusionReason: null };
  return {
    taskName: run.config_snapshot.name,
    coverageStart: run.coverage_start,
    coverageEnd: run.coverage_end,
    generatedAt: new Date().toISOString(),
    itemCount: hasItem ? 1 : 0,
    importantFacts: hasItem ? [item] : [],
    trendSignals: [],
    otherItems: [],
    sourceList: hasItem ? [{ source: item.source, url: item.sourceUrl, publishedAt: item.publishedAt, sourceTier: item.sourceTier, origin: item.origin }] : [],
    metadata: {
      overview: retrievalStatus === "failed" ? "隔离测试检索失败。" : hasItem ? "隔离测试生成 1 条确定性事件。" : "隔离测试未发现新事件。",
      origins: ["web-search"],
      generationProvider: "fixture",
      generationModel: null,
      retrieval: {
        status: retrievalStatus,
        providers,
        searchCandidates: hasItem || verifiedEmpty ? 1 : 0,
        relevancePassed: hasItem ? 1 : 0,
        relevanceDropped: 0,
        evidence: { full: hasItem || verifiedEmpty ? 1 : 0, partial: 0, unavailable: 0 },
        final: { facts: hasItem ? 1 : 0, clues: 0, trends: 0 },
        coverageConclusion: hasItem ? "items_found" : verifiedEmpty ? "verified_no_matching_items" : "insufficient_evidence",
        ...(scenario === "partial" ? { sources: [
          verifiedSource,
          { url: `https://fixture.local/intelligence/${run.id}/unavailable`, title: "取证失败的受控候选", source: "Fixture unavailable source", sourceTier: "C", provider: "fixture-secondary", publishedAt: null, fetchedAt: item.fetchedAt, evidenceStatus: "unavailable", exclusionReason: "fixture_timeout" },
        ] } : verifiedEmpty ? { sources: [verifiedSource] } : {}),
      },
    },
  };
}

export interface IntelligenceRunDependencies {
  getGenerationAccess?: typeof getGenerationAccess;
  generateBrief?: typeof generateBrief;
  /** 仅供 NODE_ENV=test 的隔离 worker 注入受控 transport。 */
  testOnlyInfrastructure?: Pick<IntelligenceResearchInfrastructureOptions, "deepSeekFetchImpl" | "generationStreamChatImpl" | "generationToolChatImpl" | "testEvidenceAcquirer">;
}

export async function runClaimedIntelligenceRun(run: IntelligenceRunRow, workerKey = "direct", dependencies: IntelligenceRunDependencies = {}): Promise<void> {
  if (dependencies.testOnlyInfrastructure && process.env.NODE_ENV !== "test") {
    throw new Error("INTELLIGENCE_TEST_TRANSPORTS_REQUIRE_TEST_ENV");
  }
  const leaseIntervalMs = process.env.NODE_ENV === "test"
    ? Math.max(25, Number(process.env.INTELLIGENCE_TEST_LEASE_INTERVAL_MS) || 30_000)
    : 30_000;
  let providerCallStarted = false;
  let durableAttemptTracking = false;
  const leaseTimer = setInterval(() => {
    renewIntelligenceRunLease(run.id, run.user_id, workerKey).then((renewed) => {
      if (!renewed) console.warn(`[intelligence-worker] lease ownership lost for ${workerKey.slice(0, 120)}`);
    }).catch(() => {
      console.warn(`[intelligence-worker] lease renewal failed for ${workerKey.slice(0, 120)}`);
    });
  }, leaseIntervalMs);
  leaseTimer.unref?.();
  try {
    const existingBrief = await query<{
      task_name: string; coverage_start: string; coverage_end: string; generated_at: string; item_count: number;
      important_facts: BriefResult["importantFacts"]; trend_signals: BriefResult["trendSignals"];
      other_items: BriefResult["otherItems"]; source_list: BriefResult["sourceList"]; metadata: BriefResult["metadata"];
    }>(
      `SELECT task_name,coverage_start,coverage_end,generated_at,item_count,
              important_facts,trend_signals,other_items,source_list,metadata
         FROM intelligence_briefs WHERE run_id = $1 AND user_id = $2`,
      [run.id, run.user_id]
    );
    if (existingBrief[0]) {
      const retrieval = asObject(asObject(existingBrief[0].metadata).retrieval);
      const retrievalStatus = retrieval.status === "partial" ? "partial" : retrieval.status === "failed" ? "failed" : "success";
      // 兼容早期非原子版本：已有成果时在一个事务中补齐 evidence 与 run 终态。
      if (retrievalStatus === "failed" && run.attempt_count > 1) {
        // Continue into the provider path. attempt_history retains the failed attempt.
      } else {
        await completeRunAtomically(run, {
          taskName: existingBrief[0].task_name,
          coverageStart: existingBrief[0].coverage_start,
          coverageEnd: existingBrief[0].coverage_end,
          generatedAt: existingBrief[0].generated_at,
          itemCount: existingBrief[0].item_count,
          importantFacts: existingBrief[0].important_facts,
          trendSignals: existingBrief[0].trend_signals,
          otherItems: existingBrief[0].other_items,
          sourceList: existingBrief[0].source_list,
          metadata: existingBrief[0].metadata,
        }, workerKey);
        return;
      }
    }

    const fixtureMode = process.env.NODE_ENV === "test" && process.env.INTELLIGENCE_FIXTURE_MODE === "1";
    if (fixtureMode) {
      const fixtureDelay = Math.max(0, Math.min(5_000, Number(process.env.INTELLIGENCE_TEST_FIXTURE_DELAY_MS) || 0));
      if (fixtureDelay) await new Promise((resolve) => setTimeout(resolve, fixtureDelay));
      const brief = fixtureBrief(run);
      await completeRunAtomically(run, brief, workerKey);
      return;
    }

    const generation = await (dependencies.getGenerationAccess ?? getGenerationAccess)(run.user_id);
    if (!generation) {
      await query(
        `UPDATE intelligence_runs SET status='blocked',finished_at=NOW(),locked_at=NULL,locked_by=NULL,
                error_code='generation_unavailable',error_message_safe='AI 配置或可用额度不足，本次没有调用模型。',
                attempt_history=attempt_history || jsonb_build_array(jsonb_build_object('attempt',attempt_count,'finishedAt',NOW(),'event','blocked','code','generation_unavailable'))
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3`,
        [run.id, run.user_id, workerKey.slice(0, 120)]
      );
      return;
    }
    const deepSeekOnly = run.external_cost_authorization?.retrievalProviderMode === "deepseek-only";
    const deepSeekGeneration = generation.credentials.provider === "deepseek";
    durableAttemptTracking = deepSeekGeneration;
    const invalidDeepSeekEnvelope = generation.source !== "custom"
      || run.external_cost_authorization?.deepSeekGeneration !== true
      || run.external_cost_authorization?.maxUsdMicros !== DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS
      || !isOfficialDeepSeekBaseUrl(generation.credentials.baseURL);
    if ((deepSeekOnly && (!deepSeekGeneration || invalidDeepSeekEnvelope))
      || (deepSeekGeneration && invalidDeepSeekEnvelope)) {
      await query(
        `UPDATE intelligence_runs SET status='blocked',finished_at=NOW(),locked_at=NULL,locked_by=NULL,
                error_code='deepseek_generation_not_authorized',provider_call_state='none',
                error_message_safe='本次运行要求 DeepSeek BYOK、官方端点及 USD 0.10 完整授权，没有调用任何模型。',
                attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
                  'attempt',attempt_count,'finishedAt',NOW(),'event','blocked','code','deepseek_generation_not_authorized'
                ))
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3`,
        [run.id, run.user_id, workerKey.slice(0, 120)],
      );
      return;
    }
    if (generation.source === "platform" && !(await reservePlatformQuotaForRun(run))) {
      await query(
        `UPDATE intelligence_runs SET status='blocked',finished_at=NOW(),locked_at=NULL,locked_by=NULL,
                error_code='quota_unavailable',error_message_safe='平台额度不足，本次没有调用模型。',
                attempt_history=attempt_history || jsonb_build_array(jsonb_build_object('attempt',attempt_count,'finishedAt',NOW(),'event','blocked','code','quota_unavailable'))
          WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3`,
        [run.id, run.user_id, workerKey.slice(0, 120)]
      );
      return;
    }
    if (!(await markProviderCallStarted(run, workerKey))) {
      // 所有权已丢失时绝不开始供应商调用；尚未使用的平台 reservation 可安全释放。
      if (generation.source === "platform") await settleQuotaReservation(run, "released");
      return;
    }
    providerCallStarted = true;
    const generated = await (dependencies.generateBrief ?? generateBrief)(
      run.user_id,
      run.task_id,
      run.config_snapshot,
      new Date(run.coverage_end),
      run.scheduled_for ?? undefined,
      { ...generation.credentials, provider: generation.credentials.provider },
      run.id,
      true,
      {
        ...(dependencies.testOnlyInfrastructure ?? {}),
        authorizeDeepSeekSearchByok: run.external_cost_authorization?.deepSeekSearch === true,
        // 首次真实验证明确关闭 DeepSeek Fetch；未来必须另行取得单次授权。
        authorizeDeepSeekFetchByok: false,
        deepSeekDurableAttemptLedger: createDeepSeekRunAttemptLedger(run, workerKey),
        deepSeekGenerationDurableLedger: createDeepSeekGenerationRunAttemptLedger(run, workerKey),
        requireDeepSeekGenerationBudget: true,
        retrievalProviderMode: run.external_cost_authorization?.retrievalProviderMode === "deepseek-only" ? "deepseek-only" : "default",
        onDeepSeekSearchFetchAudit: (audit) => recordDeepSeekSearchFetchAudit(run, workerKey, audit),
        pipelineStore: createIntelligencePipelineStore(run, workerKey),
         briefGeneratedAt: new Date(),
      },
    );
    await completeRunAtomically(run, generated.brief, workerKey);
  } catch (error) {
    let unsettledAttempts = 0;
    if (providerCallStarted && durableAttemptTracking) {
      try {
        unsettledAttempts = await unsettledExternalAttemptCount(run.id, run.user_id);
      } catch {
        // 无法读取持久账本时保守视为存在未结算调用，绝不自动重试。
        unsettledAttempts = 1;
      }
    }
    const failure = classifyIntelligenceRunFailure(error, { providerCallStarted, durableAttemptTracking, unsettledAttempts });
    const freshExternalAuthorizationRequired = run.external_cost_authorization?.deepSeekSearch === true
      || run.external_cost_authorization?.deepSeekGeneration === true;
    await query(
      `UPDATE intelligence_runs SET status=$1::text,finished_at=NOW(),locked_at=NULL,locked_by=NULL,
              provider_call_state=$2::text,external_cost_authorization='{}'::jsonb,
               usage=usage || jsonb_build_object('freshExternalAuthorizationRequired',$5::boolean),
               error_code=$3::text,error_message_safe=$4::text,
               attempt_history=attempt_history || jsonb_build_array(jsonb_build_object('attempt',attempt_count,'finishedAt',NOW(),'event',$6::text,'code',$3::text))
         WHERE id=$7 AND user_id=$8 AND status='running' AND locked_by=$9::text`,
      [failure.status, failure.providerCallState, failure.code, failure.message, freshExternalAuthorizationRequired, failure.event, run.id, run.user_id, workerKey.slice(0, 120)]
    );
    if (failure.providerCallState === "uncertain") {
      await markUnsettledDeepSeekAttemptsUncertain(run.id, run.user_id);
    }
    // 只有供应商闸门已开启才保守计为 consumed；调用前失败则释放 reservation。
    await settleQuotaReservation(run, providerCallStarted ? "consumed" : "released");
  } finally {
    clearInterval(leaseTimer);
  }
}

export async function processNextIntelligenceRun(workerKey: string): Promise<string | null> {
  const run = await claimNextIntelligenceRun(workerKey);
  if (!run) return null;
  await runClaimedIntelligenceRun(run, workerKey);
  return run.id;
}

export async function processIntelligenceRunById(
  runId: string,
  userId: string,
  workerKey: string,
  dependencies: IntelligenceRunDependencies = {},
): Promise<string | null> {
  const run = await claimIntelligenceRunById(runId, userId, workerKey);
  if (!run) return null;
  await runClaimedIntelligenceRun(run, workerKey, dependencies);
  return run.id;
}

export async function heartbeatIntelligenceWorker(workerKey: string, startedAt: Date): Promise<void> {
  await query(
    `INSERT INTO intelligence_scheduler_heartbeats (worker_key,last_heartbeat_at,started_at,metadata)
     VALUES ($1,NOW(),$2,'{}'::jsonb)
     ON CONFLICT (worker_key) DO UPDATE SET last_heartbeat_at=NOW(),started_at=EXCLUDED.started_at`,
    [workerKey.slice(0, 120), startedAt.toISOString()]
  );
}

export async function recordIntelligenceSchedulerCycle(workerKey: string, succeeded: boolean, errorCode?: string): Promise<void> {
  await query(
    `INSERT INTO intelligence_scheduler_heartbeats
       (worker_key,last_heartbeat_at,started_at,last_cycle_succeeded_at,last_cycle_error_at,last_cycle_error_code,metadata)
     VALUES ($1,NOW(),NOW(),CASE WHEN $2 THEN NOW() ELSE NULL END,CASE WHEN $2 THEN NULL ELSE NOW() END,$3,'{}'::jsonb)
     ON CONFLICT (worker_key) DO UPDATE SET
       last_heartbeat_at=NOW(),
       last_cycle_succeeded_at=CASE WHEN $2 THEN NOW() ELSE intelligence_scheduler_heartbeats.last_cycle_succeeded_at END,
       last_cycle_error_at=CASE WHEN $2 THEN intelligence_scheduler_heartbeats.last_cycle_error_at ELSE NOW() END,
       last_cycle_error_code=CASE WHEN $2 THEN NULL ELSE $3 END`,
    [workerKey.slice(0, 120), succeeded, succeeded ? null : (errorCode || "cycle_failed").slice(0, 80)],
  );
}

export async function initializeScheduledTasks(now = new Date()): Promise<number> {
  const tasks = await query<IntelligenceTaskRow>(
    `SELECT id,user_id,name,topics,entities,keywords,regions,include_requirements,
            exclude_requirements,max_items,lookback_period,output_instructions,
            execution_mode,schedule_config,is_active,config_version,event_types,
            source_policy,next_run_at,archived_at
       FROM intelligence_tasks
      WHERE archived_at IS NULL AND is_active=true AND execution_mode='scheduled'
        AND next_run_at IS NULL`
  );
  let updated = 0;
  for (const task of tasks) {
    if (!task.schedule_config) continue;
    const next = nextScheduledAt(task.schedule_config, now);
    const rows = await query<{ id: string }>(
      "UPDATE intelligence_tasks SET next_run_at=$1 WHERE id=$2 AND user_id=$3 AND next_run_at IS NULL RETURNING id",
      [next.toISOString(), task.id, task.user_id]
    );
    if (rows[0]) updated += 1;
  }
  return updated;
}

export async function enqueueDueIntelligenceRuns(now = new Date()): Promise<number> {
  const due = await query<IntelligenceTaskRow>(
    `SELECT id,user_id,name,topics,entities,keywords,regions,include_requirements,
            exclude_requirements,max_items,lookback_period,output_instructions,
            execution_mode,schedule_config,is_active,config_version,event_types,
            source_policy,next_run_at,archived_at
       FROM intelligence_tasks
      WHERE archived_at IS NULL AND is_active=true AND execution_mode='scheduled'
        AND next_run_at IS NOT NULL AND next_run_at <= $1
      ORDER BY next_run_at ASC
      LIMIT 100`,
    [now.toISOString()]
  );
  let queued = 0;
  for (const task of due) {
    if (!task.schedule_config || !task.next_run_at) continue;
    const scheduledFor = new Date(task.next_run_at);
    const allowed = isCatchupAllowed(scheduledFor, now);
    const created = await createIntelligenceRunWithDisposition({
      userId: task.user_id,
      taskId: task.id,
      idempotencyKey: scheduledSlotKey(task.id, scheduledFor),
      triggerType: now.getTime() - scheduledFor.getTime() > 60_000 ? "catchup" : "scheduled",
      scheduledFor,
      now,
    });
    // 同一主题已有其他用户意图的活跃 run 时，计划槽仍保持到期状态。
    // 待活跃 run 完成后，后续 scheduler cycle 会再为本槽创建自己的幂等 run；
    // 不得误改手动 run，也不得提前消费本期计划。
    if (created.disposition === "blocked_by_active_run") continue;
    const run = created.run;
    if (!allowed && run.status === "queued") {
      await query(
        `UPDATE intelligence_runs SET status='blocked',finished_at=NOW(),
                error_code='missed_window',error_message_safe='错过补跑窗口，未调用外部服务。'
          WHERE id=$1 AND user_id=$2`,
        [run.id, run.user_id]
      );
    } else if (run.status === "queued") {
      queued += 1;
    }
    const next = nextRunAfterDueSlot(task.schedule_config, scheduledFor, now, allowed);
    await query(
      "UPDATE intelligence_tasks SET next_run_at=$1 WHERE id=$2 AND user_id=$3 AND next_run_at <= $4",
      [next.toISOString(), task.id, task.user_id, now.toISOString()]
    );
  }
  return queued;
}

export async function retryIntelligenceRun(userId: string, runId: string): Promise<IntelligenceRunRow | null> {
  try {
    const rows = await query<IntelligenceRunRow>(
      `UPDATE intelligence_runs r SET status='queued',trigger_type='retry',finished_at=NULL,
              error_code=NULL,error_message_safe=NULL,locked_at=NULL,
              provider_call_state='none',provider_call_started_at=NULL,
              external_cost_authorization='{}'::jsonb,
              attempt_history=r.attempt_history || jsonb_build_array(jsonb_build_object('event','retry-requested','at',NOW()))
         FROM intelligence_tasks t
        WHERE r.id=$1 AND r.user_id=$2 AND r.status IN ('failed','blocked') AND r.attempt_count < r.max_attempts
          AND t.id=r.task_id AND t.user_id=r.user_id AND t.is_active=true AND t.archived_at IS NULL
          AND COALESCE((r.usage->>'freshExternalAuthorizationRequired')::boolean,false)=false
          AND COALESCE((r.external_cost_authorization->>'deepSeekSearch')::boolean,false)=false
          AND COALESCE((r.external_cost_authorization->>'deepSeekGeneration')::boolean,false)=false
          AND NOT EXISTS (
            SELECT 1 FROM intelligence_run_external_attempts a
             WHERE a.run_id=r.id AND a.user_id=r.user_id
          )
        RETURNING r.*`,
      [runId, userId]
    );
    return rows[0] ?? null;
  } catch (error) {
    // 同一主题已有 queued/running run 时，重试不得破坏其状态或冒泡成 500。
    if ((error as { code?: string })?.code === "23505") return null;
    throw error;
  }
}
