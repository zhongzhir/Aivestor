import { NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { normalizeTaskInput, validateTaskInput } from "@/lib/intelligence";
import { activeTaskLimitError, intelligenceLimitError, requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { cancelQueuedIntelligenceRunsForTask } from "@/lib/intelligenceRuns";
import { nextScheduledAt } from "@/lib/intelligenceSchedule";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await query<Record<string, unknown>>(
    `SELECT t.*,
            lr.id AS last_run_id,lr.status AS last_run_status,lr.finished_at AS last_run_finished_at,
            lr.retrieval_status AS last_retrieval_status,lr.error_code AS last_run_error_code,
            lr.error_message_safe AS last_run_error,
            lb.id AS latest_brief_id,lb.generated_at AS last_generated_at
       FROM intelligence_tasks t
       LEFT JOIN LATERAL (
         SELECT id,status,finished_at,retrieval_status,error_code,error_message_safe
           FROM intelligence_runs WHERE task_id=t.id AND user_id=t.user_id
          ORDER BY created_at DESC LIMIT 1
       ) lr ON true
       LEFT JOIN LATERAL (
         SELECT id,generated_at FROM intelligence_briefs
          WHERE task_id=t.id AND user_id=t.user_id ORDER BY generated_at DESC LIMIT 1
       ) lb ON true
      WHERE t.id=$1 AND t.user_id=$2`,
    [params.id, guard.access.userId]
  );
  if (!rows[0]) return NextResponse.json({ error: "情报主题不存在" }, { status: 404 });
  return NextResponse.json({ task: rows[0] });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  // Ownership must be established before parsing or validating attacker-controlled
  // input; otherwise another user's id can produce distinguishable 400 responses.
  const owned = await query<{ id: string }>(
    "SELECT id FROM intelligence_tasks WHERE id=$1 AND user_id=$2 AND archived_at IS NULL",
    [params.id, guard.access.userId],
  );
  if (!owned[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input = normalizeTaskInput(body);
    if (!input.name) return NextResponse.json({ error: "任务名称不能为空" }, { status: 400 });
    const validationError = validateTaskInput(input);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const limitError = intelligenceLimitError(guard.access, input);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });
    if (input.isActive) {
      const taskLimitError = await activeTaskLimitError(guard.access, params.id);
      if (taskLimitError) return NextResponse.json({ error: taskLimitError }, { status: 400 });
    }
    const eventTypes = Array.isArray(body.eventTypes)
      ? body.eventTypes.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 40)).filter(Boolean).slice(0, 12)
      : null;
    const sourcePolicy = body.sourcePolicy && typeof body.sourcePolicy === "object" && !Array.isArray(body.sourcePolicy)
      ? body.sourcePolicy as Record<string, unknown>
      : null;
    const nextRunAt = input.isActive && input.executionMode === "scheduled" && input.scheduleConfig
      ? nextScheduledAt(input.scheduleConfig, new Date()).toISOString()
      : null;
    const rows = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE intelligence_tasks SET
          name=$1,topics=$2::jsonb,entities=$3::jsonb,keywords=$4::jsonb,regions=$5::jsonb,
          include_requirements=$6::jsonb,exclude_requirements=$7::jsonb,max_items=$8,
          lookback_period=$9::jsonb,output_instructions=$10,execution_mode=$11,
          schedule_config=$12::jsonb,is_active=$13,
          event_types=COALESCE($14::jsonb,event_types),
          source_policy=COALESCE($15::jsonb,source_policy),
          next_run_at=$16,config_version=config_version+1
        WHERE id=$17 AND user_id=$18 AND archived_at IS NULL
        RETURNING *`,
        [input.name, JSON.stringify(input.topics), JSON.stringify(input.entities), JSON.stringify(input.keywords), JSON.stringify(input.regions), JSON.stringify(input.includeRequirements), JSON.stringify(input.excludeRequirements), input.maxItems, JSON.stringify(input.lookbackPeriod), input.outputInstructions, input.executionMode, input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null, input.isActive, eventTypes ? JSON.stringify(eventTypes) : null, sourcePolicy ? JSON.stringify(sourcePolicy) : null, nextRunAt, params.id, guard.access.userId]
      );
      if (updated.rows[0] && !input.isActive) {
        await cancelQueuedIntelligenceRunsForTask(guard.access.userId, params.id, "task_paused", client);
      }
      return updated.rows;
    });
    if (!rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    return NextResponse.json({ task: rows[0] });
  } catch (error) {
    console.error("[intelligence] update task failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存任务失败，请稍后重试。" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE intelligence_tasks
        SET archived_at=NOW(),is_active=false,next_run_at=NULL,config_version=config_version+1
      WHERE id=$1 AND user_id=$2 AND archived_at IS NULL
      RETURNING id`,
      [params.id, guard.access.userId]
    );
    if (updated.rows[0]) {
      await cancelQueuedIntelligenceRunsForTask(guard.access.userId, params.id, "task_archived", client);
    }
    return updated.rows;
  });
  if (!rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PUT(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await query(
    `UPDATE intelligence_tasks
        SET archived_at=NULL,is_active=false,next_run_at=NULL,config_version=config_version+1
      WHERE id=$1 AND user_id=$2 AND archived_at IS NOT NULL
      RETURNING *`,
    [params.id, guard.access.userId],
  );
  if (!rows[0]) return NextResponse.json({ error: "归档主题不存在" }, { status: 404 });
  return NextResponse.json({ task: rows[0] });
}
