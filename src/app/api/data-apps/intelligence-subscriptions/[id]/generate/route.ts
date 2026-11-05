import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { createIntelligenceRun, publicIntelligenceRun } from "@/lib/intelligenceRuns";
import { DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS } from "@/lib/intelligenceDeepSeekGenerationBudget";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const key = (request.headers.get("idempotency-key") || randomUUID()).trim();
  const body = await request.json().catch(() => ({})) as {
    authorizeDeepSeekSearch?: unknown;
    authorizeDeepSeekGeneration?: unknown;
    deepSeekOnly?: unknown;
  };
  const authorizeDeepSeekSearch = body.authorizeDeepSeekSearch === true;
  const authorizeDeepSeekGeneration = body.authorizeDeepSeekGeneration === true;
  try {
    const run = await createIntelligenceRun({
      userId: guard.access.userId,
      taskId: params.id,
      idempotencyKey: key,
      triggerType: "manual",
      authorizeDeepSeekSearch,
      authorizeDeepSeekGeneration,
      maxExternalCostUsdMicros: authorizeDeepSeekSearch || authorizeDeepSeekGeneration
        ? DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS
        : undefined,
      retrievalProviderMode: body.deepSeekOnly === true ? "deepseek-only" : "default",
    });
    return NextResponse.json({ run: publicIntelligenceRun(run), idempotencyKey: key }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法创建运行记录";
    return NextResponse.json({ error: message }, { status: /不存在/.test(message) ? 404 : 400 });
  }
}
