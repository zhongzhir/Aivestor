import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateBrief, normalizeTaskInput } from "@/lib/intelligence";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { getGenerationAccess, reserveIntelligenceQuota } from "@/lib/intelligenceGeneration";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await query<Record<string, unknown>>(`SELECT * FROM intelligence_tasks WHERE id=$1 AND user_id=$2`, [params.id, guard.access.userId]);
  const task = rows[0];
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const input = normalizeTaskInput({ ...task, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: task.schedule_config, isActive: task.is_active });
  if (!input.isActive) return NextResponse.json({ error: "请先启用这个情报任务，再生成简报。" }, { status: 400 });
  const generation = await getGenerationAccess(guard.access.userId);
  if (!generation) return NextResponse.json({ error: "生成情报简报会消耗 AI 额度。你可以使用平台额度、配置自己的 AI API，或升级机构版获得更高额度和团队能力。", code: "quota_unavailable" }, { status: 402 });
  if (generation.source === "platform" && !(await reserveIntelligenceQuota(guard.access.userId))) {
    await query("UPDATE intelligence_tasks SET is_active = false WHERE id = $1 AND user_id = $2", [params.id, guard.access.userId]);
    return NextResponse.json({ error: "生成情报简报会消耗 AI 额度。你可以使用平台额度、配置自己的 AI API，或升级机构版获得更高额度和团队能力。", code: "quota_unavailable", paused: true }, { status: 402 });
  }
  try {
    const result = await generateBrief(guard.access.userId, params.id, input, new Date(), undefined, { ...generation.credentials, provider: generation.credentials.provider });
    return NextResponse.json({ ...result, aiSource: generation.source }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: 400 });
  }
}
