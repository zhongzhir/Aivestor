import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeTaskInput, validateTaskInput } from "@/lib/intelligence";
import { activeTaskLimitError, intelligenceLimitError, requireIntelligenceAPI } from "@/lib/intelligenceAccess";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const input = normalizeTaskInput(await request.json());
  if (!input.name) return NextResponse.json({ error: "任务名称不能为空" }, { status: 400 });
  const validationError = validateTaskInput(input);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const limitError = intelligenceLimitError(guard.access, input);
  if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });
  if (input.isActive) {
    const taskLimitError = await activeTaskLimitError(guard.access, params.id);
    if (taskLimitError) return NextResponse.json({ error: taskLimitError }, { status: 400 });
  }
  const rows = await query(`UPDATE intelligence_tasks SET name=$1,topics=$2::jsonb,entities=$3::jsonb,keywords=$4::jsonb,regions=$5::jsonb,include_requirements=$6::jsonb,exclude_requirements=$7::jsonb,max_items=$8,lookback_period=$9::jsonb,output_instructions=$10,execution_mode=$11,schedule_config=$12::jsonb,is_active=$13 WHERE id=$14 AND user_id=$15 RETURNING *`, [input.name, JSON.stringify(input.topics), JSON.stringify(input.entities), JSON.stringify(input.keywords), JSON.stringify(input.regions), JSON.stringify(input.includeRequirements), JSON.stringify(input.excludeRequirements), input.maxItems, JSON.stringify(input.lookbackPeriod), input.outputInstructions, input.executionMode, input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null, input.isActive, params.id, guard.access.userId]);
  if (!rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ task: rows[0] });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await query(`DELETE FROM intelligence_tasks WHERE id=$1 AND user_id=$2 RETURNING id`, [params.id, guard.access.userId]);
  if (!rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
