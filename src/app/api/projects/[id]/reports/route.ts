import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  buildGenerationMessages,
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import type { FinancialData } from "@/lib/types";

export const maxDuration = 120;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  financial_data: FinancialData | null;
}

// POST /api/projects/[id]/reports — 生成项目分析报告（流式）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  let body: { judgmentPoints?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const judgmentPoints = Array.isArray(body.judgmentPoints)
    ? body.judgmentPoints
        .map((p) => String(p).trim())
        .filter((p) => p.length > 0)
    : [];
  if (judgmentPoints.length < 3 || judgmentPoints.length > 10) {
    return NextResponse.json(
      { error: "请输入 3–10 条判断要点" },
      { status: 400 }
    );
  }

  // 加载项目
  const projects = await query<ProjectRow>(
    `SELECT name, company_name, industry, stage, financial_data
       FROM projects WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (projects.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const project = projects[0];

  // 拼接该项目下所有 BP 文档文本
  const docs = await query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM documents
      WHERE project_id = $1
        AND extracted_text IS NOT NULL
        AND doc_kind IN ('bp', 'research', 'other')
      ORDER BY created_at ASC`,
    [params.id]
  );
  const bpText = docs
    .map((d) => d.extracted_text)
    .filter(Boolean)
    .join("\n\n---\n\n");
  if (!bpText) {
    return NextResponse.json(
      { error: "该项目尚未上传可解析的 BP 文档" },
      { status: 400 }
    );
  }

  // 保存本轮判断要点到项目
  await query("UPDATE projects SET judgment_points = $1 WHERE id = $2", [
    JSON.stringify(judgmentPoints),
    params.id,
  ]);

  // 先创建报告占位行，便于把 reportId 通过响应头返回
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status)
     VALUES ($1, $2, $3, '', 'draft')
     RETURNING id`,
    [params.id, session.user.id, `${project.name} · 项目分析报告`]
  );
  const reportId = created[0].id;

  const { system, messages } = buildGenerationMessages({
    projectName: project.name,
    companyName: project.company_name,
    industry: project.industry,
    stage: project.stage,
    bpText,
    judgmentPoints,
    financialData: project.financial_data,
  });

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "report-generate"),
    system: await injectProfile(session.user.id, system),
    messages,
  });

  const res = streamTextResponse(generator, async (fullText) => {
    await query("UPDATE reports SET content = $1 WHERE id = $2", [
      fullText,
      reportId,
    ]);
  });
  res.headers.set("X-Report-Id", reportId);
  return res;
}
