import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeTaskInput, validateTaskInput } from "@/lib/intelligence";
import { intelligenceLimitError, activeTaskLimitError, requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { getGenerationAccess } from "@/lib/intelligenceGeneration";
import { nextScheduledAt, isSchedulerHeartbeatFresh } from "@/lib/intelligenceSchedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const tasks = await query(
    `SELECT t.*,
            lr.id AS last_run_id,lr.status AS last_run_status,lr.started_at AS last_run_started_at,
            lr.finished_at AS last_run_finished_at,lr.retrieval_status AS last_retrieval_status,
            lr.error_code AS last_run_error_code,lr.error_message_safe AS last_run_error,
            lb.id AS latest_brief_id,lb.generated_at AS last_generated_at,
            lb.coverage_start AS latest_coverage_start,lb.coverage_end AS latest_coverage_end,
            lb.item_count AS latest_item_count,lb.metadata AS latest_brief_metadata
       FROM intelligence_tasks t
       LEFT JOIN LATERAL (
         SELECT id,status,started_at,finished_at,retrieval_status,error_code,error_message_safe
           FROM intelligence_runs WHERE task_id=t.id AND user_id=t.user_id
          ORDER BY created_at DESC LIMIT 1
       ) lr ON true
       LEFT JOIN LATERAL (
         SELECT id,generated_at,coverage_start,coverage_end,item_count,metadata
           FROM intelligence_briefs WHERE task_id=t.id AND user_id=t.user_id
          ORDER BY generated_at DESC LIMIT 1
       ) lb ON true
      WHERE t.user_id=$1 AND t.archived_at IS NULL
      ORDER BY t.updated_at DESC`,
    [guard.access.userId]
  );
  const generation = await getGenerationAccess(guard.access.userId);
  const archivedTasks = await query(
    `SELECT id,name,topics,entities,execution_mode,is_active,archived_at,created_at,updated_at
       FROM intelligence_tasks
      WHERE user_id=$1 AND archived_at IS NOT NULL
      ORDER BY archived_at DESC`,
    [guard.access.userId],
  );
  const briefs = await query(`SELECT id, task_id, task_name, coverage_start, coverage_end, generated_at, item_count, important_facts, trend_signals, other_items, source_list, metadata FROM intelligence_briefs WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 10`, [guard.access.userId]);
  const heartbeat = await query<{ last_heartbeat_at: string | null; last_cycle_succeeded_at: string | null; last_cycle_error_at: string | null; last_cycle_error_code: string | null }>(
    `SELECT MAX(last_heartbeat_at)::text AS last_heartbeat_at,
            MAX(last_cycle_succeeded_at)::text AS last_cycle_succeeded_at,
            MAX(last_cycle_error_at)::text AS last_cycle_error_at,
            (ARRAY_AGG(last_cycle_error_code ORDER BY last_cycle_error_at DESC NULLS LAST))[1] AS last_cycle_error_code
       FROM intelligence_scheduler_heartbeats`
  );
  const heartbeatAt = heartbeat[0]?.last_heartbeat_at ?? null;
  const lastSuccessAt = heartbeat[0]?.last_cycle_succeeded_at ?? null;
  const lastErrorAt = heartbeat[0]?.last_cycle_error_at ?? null;
  const cycleHealthy = isSchedulerHeartbeatFresh(lastSuccessAt)
    && (!lastErrorAt || !!lastSuccessAt && new Date(lastSuccessAt).getTime() >= new Date(lastErrorAt).getTime());
  return NextResponse.json({
    tasks,
    archivedTasks,
    briefs,
    aiSource: generation?.source ?? null,
    quotaAvailable: !!generation,
    scheduler: {
      lastHeartbeatAt: heartbeatAt,
      lastSuccessAt,
      lastErrorAt,
      lastErrorCode: heartbeat[0]?.last_cycle_error_code ?? null,
      healthy: isSchedulerHeartbeatFresh(heartbeatAt) && cycleHealthy,
    },
  });
}

export async function POST(request: Request) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  let createRequestKey = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    // 新客户端提供稳定 key，可在响应丢失后恢复；旧客户端无 key 时仍保持兼容，
    // 返回服务端生成的 key 供后续显式重试使用。
    createRequestKey = (request.headers.get("idempotency-key") || (typeof body.clientRequestKey === "string" ? body.clientRequestKey : "") || randomUUID()).trim().slice(0, 200);
    const existing = await query<Record<string, unknown>>(
      "SELECT * FROM intelligence_tasks WHERE user_id=$1 AND create_request_key=$2",
      [guard.access.userId, createRequestKey],
    );
    if (existing[0]) return NextResponse.json({ task: existing[0], recovered: true }, { status: 200 });
    const input = normalizeTaskInput(body);
    if (!input.name) return NextResponse.json({ error: "任务名称不能为空" }, { status: 400 });
    const validationError = validateTaskInput(input);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const limitError = intelligenceLimitError(guard.access, input);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });
    if (input.isActive) {
      const taskLimitError = await activeTaskLimitError(guard.access);
      if (taskLimitError) return NextResponse.json({ error: taskLimitError }, { status: 400 });
    }
    if (input.executionMode === "scheduled" && !input.scheduleConfig) return NextResponse.json({ error: "定时任务必须配置频率、时间和时区" }, { status: 400 });
    const originalRequest = typeof body.originalRequest === "string" ? body.originalRequest.trim().slice(0, 1000) : null;
    const eventTypes = Array.isArray(body.eventTypes)
      ? body.eventTypes.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 40)).filter(Boolean).slice(0, 12)
      : [];
    const sourcePolicy = body.sourcePolicy && typeof body.sourcePolicy === "object" && !Array.isArray(body.sourcePolicy)
      ? body.sourcePolicy as Record<string, unknown>
      : {};
    const rawParse = body.parseMetadata && typeof body.parseMetadata === "object" && !Array.isArray(body.parseMetadata)
      ? body.parseMetadata as Record<string, unknown>
      : {};
    const parseMetadata = {
      method: rawParse.method === "ai" ? "ai" : "fallback",
      parsedAt: typeof rawParse.parsedAt === "string" ? rawParse.parsedAt : new Date().toISOString(),
      currentDate: typeof rawParse.currentDate === "string" ? rawParse.currentDate : null,
      warnings: Array.isArray(rawParse.warnings) ? rawParse.warnings.filter((value): value is string => typeof value === "string").slice(0, 10) : [],
    };
    const nextRunAt = input.isActive && input.executionMode === "scheduled" && input.scheduleConfig
      ? nextScheduledAt(input.scheduleConfig, new Date()).toISOString()
      : null;
    const rows = await query(
      `INSERT INTO intelligence_tasks
         (user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,original_request,create_request_key,event_types,
          source_policy,next_run_at,parse_metadata)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,
               $9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20::jsonb)
       RETURNING *`,
      [guard.access.userId, input.name, JSON.stringify(input.topics), JSON.stringify(input.entities), JSON.stringify(input.keywords), JSON.stringify(input.regions), JSON.stringify(input.includeRequirements), JSON.stringify(input.excludeRequirements), input.maxItems, JSON.stringify(input.lookbackPeriod), input.outputInstructions, input.executionMode, input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null, input.isActive, originalRequest, createRequestKey, JSON.stringify(eventTypes), JSON.stringify(sourcePolicy), nextRunAt, JSON.stringify(parseMetadata)]
    );
    return NextResponse.json({ task: rows[0], createRequestKey }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" && createRequestKey) {
      const recovered = await query<Record<string, unknown>>(
        "SELECT * FROM intelligence_tasks WHERE user_id=$1 AND create_request_key=$2",
        [guard.access.userId, createRequestKey],
      );
      if (recovered[0]) return NextResponse.json({ task: recovered[0], recovered: true }, { status: 200 });
    }
    console.error("[intelligence] create task failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建任务失败，请稍后重试。" }, { status: 500 });
  }
}
