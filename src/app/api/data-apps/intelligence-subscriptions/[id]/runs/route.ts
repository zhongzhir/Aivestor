import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { decodeIntelligenceCursor, encodeIntelligenceCursor } from "@/lib/intelligenceCursor";
import { createIntelligenceRun, publicIntelligenceRun } from "@/lib/intelligenceRuns";
import { DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS } from "@/lib/intelligenceDeepSeekGenerationBudget";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const owned = await query<{ id: string }>("SELECT id FROM intelligence_tasks WHERE id=$1 AND user_id=$2", [params.id, guard.access.userId]);
  if (!owned[0]) return NextResponse.json({ error: "情报主题不存在" }, { status: 404 });
  const cursor = decodeIntelligenceCursor(url.searchParams.get("cursor"));
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 10));
  const rows = await query<Record<string, unknown>>(
    `SELECT r.id,r.task_id,r.trigger_type,r.status,r.config_version,r.scheduled_for,
            r.coverage_start,r.coverage_end,r.attempt_count,r.started_at,r.finished_at,
            r.retrieval_status,r.provider_diagnostics,r.evidence_summary,r.error_code,
            r.usage,r.external_cost_authorization,r.error_message_safe,r.created_at,r.updated_at,b.id AS brief_id,
            (COALESCE((r.usage->>'freshExternalAuthorizationRequired')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekSearch')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekGeneration')::boolean,false)
              OR EXISTS (
                SELECT 1 FROM intelligence_run_external_attempts a
                 WHERE a.run_id=r.id AND a.user_id=r.user_id
              )) AS requires_fresh_authorization,
            cp.stage AS checkpoint_stage,cp.status AS checkpoint_status
       FROM intelligence_runs r
       LEFT JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
       LEFT JOIN LATERAL (
         SELECT stage,status FROM intelligence_run_checkpoints
          WHERE run_id=r.id AND user_id=r.user_id
          ORDER BY updated_at DESC LIMIT 1
       ) cp ON true
      WHERE r.user_id=$1 AND r.task_id=$2
        AND ($3::timestamptz IS NULL OR (r.created_at,r.id) < ($3::timestamptz,$4::uuid))
      ORDER BY r.created_at DESC,r.id DESC
      LIMIT $5`,
    [guard.access.userId, params.id, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );
  const hasMore = rows.length > limit;
  const runs = rows.slice(0, limit);
  const last = runs[runs.length - 1] as { created_at?: unknown; id?: unknown } | undefined;
  const nextCursor = hasMore && typeof last?.created_at === "string" && typeof last.id === "string"
    ? encodeIntelligenceCursor({ createdAt: last.created_at, id: last.id })
    : null;
  return NextResponse.json({ runs, nextCursor });
}

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
