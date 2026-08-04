import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateBrief, normalizeTaskInput } from "@/lib/intelligence";
import { requireCapabilityAPI } from "@/lib/orgAuth";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;
  const rows = await query<Record<string, unknown>>(`SELECT * FROM intelligence_tasks WHERE id=$1 AND user_id=$2`, [params.id, guard.ctx.userId]);
  const task = rows[0];
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const input = normalizeTaskInput({ ...task, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: task.schedule_config, isActive: task.is_active });
  try {
    const result = await generateBrief(guard.ctx.userId, params.id, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: 400 });
  }
}
