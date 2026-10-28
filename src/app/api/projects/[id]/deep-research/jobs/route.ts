import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";
import { getGenerationAccess, reserveIntelligenceQuota } from "@/lib/intelligenceGeneration";
import { isDeepResearchProfile } from "@/lib/deepResearch";
import type { DeepResearchJobRow } from "@/lib/deepResearchJobs";
import { canUseDeepResearchBeta } from "@/lib/deepResearchAccess";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canUseDeepResearchBeta(session.user.id))) {
    return NextResponse.json({ error: "功能未开放" }, { status: 404 });
  }
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const jobs = await query<DeepResearchJobRow & { created_at: string; updated_at: string; error_code: string | null; error_message: string | null }>(
    `SELECT id, project_id, user_id, org_id, report_id, status, phase, progress,
            requested_profile, decision_context, source_cutoff_date, result,
            attempt_count, max_attempts, error_code, error_message,
            created_at, updated_at
       FROM deep_research_jobs
      WHERE project_id = $1
      ORDER BY created_at DESC LIMIT 10`,
    [params.id]
  );
  return NextResponse.json({ jobs });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canUseDeepResearchBeta(session.user.id))) {
    return NextResponse.json({ error: "功能未开放" }, { status: 404 });
  }
  let body: { profile?: unknown; decisionContext?: unknown; sourceCutoffDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (body.profile != null && !isDeepResearchProfile(body.profile)) {
    return NextResponse.json({ error: "深度投研框架参数无效" }, { status: 422 });
  }
  const sourceCutoffDate = typeof body.sourceCutoffDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.sourceCutoffDate)
    ? body.sourceCutoffDate
    : new Date().toISOString().slice(0, 10);
  const decisionContext = typeof body.decisionContext === "string"
    ? body.decisionContext.trim().slice(0, 4_000)
    : "";
  const scope = await buildAccessScope(session.user.id);
  let orgId: string | null = null;
  try {
    orgId = (await assertProjectAccess(scope, params.id, "write")).orgId;
  } catch (error) {
    return accessErrorResponse(error);
  }
  const hasDocs = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM documents WHERE project_id = $1
         AND parse_status = 'done' AND extracted_text IS NOT NULL
     ) AS exists`,
    [params.id]
  );
  if (!hasDocs[0]?.exists) {
    return NextResponse.json({ error: "请先上传并解析至少一份项目材料" }, { status: 400 });
  }
  const active = await query<DeepResearchJobRow>(
    `SELECT * FROM deep_research_jobs
      WHERE project_id = $1 AND status IN ('queued','running')
      ORDER BY created_at DESC LIMIT 1`,
    [params.id]
  );
  if (active[0]) return NextResponse.json({ job: active[0], existing: true });

  const generation = await getGenerationAccess(session.user.id);
  if (!generation) {
    return NextResponse.json({ error: "深度投研需要可用的AI配置或平台额度" }, { status: 402 });
  }
  if (generation.source === "platform" && !(await reserveIntelligenceQuota(session.user.id))) {
    return NextResponse.json({ error: "平台研究额度不足，请配置自己的AI API或补充额度" }, { status: 402 });
  }
  try {
    const created = await query<DeepResearchJobRow>(
      `INSERT INTO deep_research_jobs
         (project_id, user_id, org_id, requested_profile, decision_context, source_cutoff_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [params.id, session.user.id, orgId, body.profile || "auto", decisionContext || null, sourceCutoffDate]
    );
    return NextResponse.json({ job: created[0], existing: false }, { status: 202 });
  } catch (error) {
    const raced = await query<DeepResearchJobRow>(
      `SELECT * FROM deep_research_jobs
        WHERE project_id = $1 AND status IN ('queued','running')
        ORDER BY created_at DESC LIMIT 1`,
      [params.id]
    );
    if (raced[0]) return NextResponse.json({ job: raced[0], existing: true });
    throw error;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canUseDeepResearchBeta(session.user.id))) {
    return NextResponse.json({ error: "功能未开放" }, { status: 404 });
  }
  let body: { jobId?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (typeof body.jobId !== "string" || body.action !== "retry") {
    return NextResponse.json({ error: "只支持重试失败任务" }, { status: 422 });
  }
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "write");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const rows = await query<DeepResearchJobRow>(
    `UPDATE deep_research_jobs
        SET status = 'queued', phase = 'queued', progress = 0,
            error_code = NULL, error_message = NULL, locked_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND project_id = $2 AND status = 'failed'
        AND attempt_count < max_attempts
      RETURNING *`,
    [body.jobId, params.id]
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "任务不可重试或已达到最大重试次数" }, { status: 409 });
  }
  return NextResponse.json({ job: rows[0] });
}
