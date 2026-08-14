import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeTaskInput, validateTaskInput } from "@/lib/intelligence";
import { intelligenceLimitError, activeTaskLimitError, requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { getGenerationAccess } from "@/lib/intelligenceGeneration";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const tasks = await query(`SELECT t.*, (SELECT MAX(generated_at) FROM intelligence_briefs b WHERE b.task_id = t.id) AS last_generated_at FROM intelligence_tasks t WHERE t.user_id = $1 ORDER BY t.updated_at DESC`, [guard.access.userId]);
  const generation = await getGenerationAccess(guard.access.userId);
  const briefs = await query(`SELECT id, task_id, task_name, coverage_start, coverage_end, generated_at, item_count, important_facts, trend_signals, other_items, source_list, metadata FROM intelligence_briefs WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 10`, [guard.access.userId]);
  return NextResponse.json({ tasks, briefs, aiSource: generation?.source ?? null, quotaAvailable: !!generation });
}

export async function POST(request: Request) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  try {
    const input = normalizeTaskInput(await request.json());
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
    const rows = await query(`INSERT INTO intelligence_tasks (user_id,name,topics,entities,keywords,regions,include_requirements,exclude_requirements,max_items,lookback_period,output_instructions,execution_mode,schedule_config,is_active) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13::jsonb,$14) RETURNING *`, [guard.access.userId, input.name, JSON.stringify(input.topics), JSON.stringify(input.entities), JSON.stringify(input.keywords), JSON.stringify(input.regions), JSON.stringify(input.includeRequirements), JSON.stringify(input.excludeRequirements), input.maxItems, JSON.stringify(input.lookbackPeriod), input.outputInstructions, input.executionMode, input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null, input.isActive]);
    return NextResponse.json({ task: rows[0] }, { status: 201 });
  } catch (error) {
    console.error("[intelligence] create task failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建任务失败，请稍后重试。" }, { status: 500 });
  }
}
