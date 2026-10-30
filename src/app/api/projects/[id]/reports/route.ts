import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  buildGenerationMessages,
  REPORT_CONTEXT_DOC_KINDS,
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";
import { injectOrgKnowledge, injectMarketContext } from "@/lib/orgInject";
import type { FinancialData } from "@/lib/types";
import {
  buildDeepResearchMessages,
  isDeepResearchProfile,
  type DeepResearchMaterial,
  type ResolvedDeepResearchProfile,
} from "@/lib/deepResearch";
import { buildDeepResearchMetadata } from "@/lib/deepResearchWorkpaper";
import { normalizeSourceMap } from "@/lib/sourceMap";
import type { DeepResearchExternalResult } from "@/lib/deepResearchExternal";
import { canUseDeepResearchBeta } from "@/lib/deepResearchAccess";
import { buildDeepResearchQuantitativeAnalysis } from "@/lib/deepResearchQuantitative";

export const maxDuration = 300;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  financial_data: FinancialData | null;
}

interface ReportDocumentRow {
  filename: string;
  doc_kind: string;
  extracted_text: string;
  source_map: unknown;
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

  let body: {
    mode?: unknown;
    profile?: unknown;
    judgmentPoints?: unknown;
    decisionContext?: unknown;
    sourceCutoffDate?: unknown;
  };
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
  const deepResearch = body.mode === "deep_research";
  if (deepResearch && !(await canUseDeepResearchBeta(session.user.id))) {
    return NextResponse.json({ error: "功能未开放" }, { status: 404 });
  }
  if ((!deepResearch && judgmentPoints.length < 3) || judgmentPoints.length > 10) {
    return NextResponse.json(
      {
        error: deepResearch
          ? "深度投研最多接收 10 条判断要点"
          : "请输入 3–10 条判断要点",
      },
      { status: 400 }
    );
  }
  if (deepResearch && body.profile != null && !isDeepResearchProfile(body.profile)) {
    return NextResponse.json({ error: "深度投研框架参数无效" }, { status: 400 });
  }
  const decisionContext =
    typeof body.decisionContext === "string"
      ? body.decisionContext.trim().slice(0, 4000)
      : "";
  const sourceCutoffDate =
    typeof body.sourceCutoffDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.sourceCutoffDate)
      ? body.sourceCutoffDate
      : null;

  // 校验项目归属（write）；orgId 用于报告跟随父项目 + 机构知识注入
  const scope = await buildAccessScope(session.user.id);
  let projectOrgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, params.id, "write");
    projectOrgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }

  // 加载项目（访问已校验，按 id 取字段即可）
  const projects = await query<ProjectRow>(
    `SELECT name, company_name, industry, stage, financial_data
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [params.id]
  );
  if (projects.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const project = projects[0];

  // 拼接该项目下所有 BP 文档文本
  const docs = await query<ReportDocumentRow>(
    `SELECT filename, doc_kind, extracted_text, source_map FROM documents
      WHERE project_id = $1
        AND extracted_text IS NOT NULL
        AND doc_kind = ANY($2::text[])
      ORDER BY created_at ASC`,
    [params.id, REPORT_CONTEXT_DOC_KINDS]
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
  const externalRows = deepResearch
    ? await query<{ external_research: DeepResearchExternalResult | null }>(
        `SELECT result->'externalResearch' AS external_research
           FROM deep_research_jobs
          WHERE project_id = $1 AND status = 'completed'
            AND result ? 'externalResearch'
          ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
        [params.id]
      )
    : [];
  const externalResearch = externalRows[0]?.external_research ?? null;
  const quantitativeAnalysis = deepResearch
    ? buildDeepResearchQuantitativeAnalysis({
        financialData: project.financial_data,
        decisionContext,
      })
    : null;

  // 保存本轮判断要点到项目
  await query("UPDATE projects SET judgment_points = $1 WHERE id = $2 AND deleted_at IS NULL", [
    JSON.stringify(judgmentPoints),
    params.id,
  ]);

  // 先创建报告占位行，便于把 reportId 通过响应头返回（org_id 跟随父项目）
  const reportTitle = deepResearch
    ? `${project.name} · 深度投研报告`
    : `${project.name} · 项目分析报告`;
  const reportKind = deepResearch ? "deep_research" : "analysis";
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status, kind, org_id)
     VALUES ($1, $2, $3, '', 'draft', $4, $5)
     RETURNING id`,
    [params.id, session.user.id, reportTitle, reportKind, projectOrgId]
  );
  const reportId = created[0].id;

  const generation = deepResearch
    ? buildDeepResearchMessages({
        projectName: project.name,
        companyName: project.company_name,
        industry: project.industry,
        stage: project.stage,
        requestedProfile: isDeepResearchProfile(body.profile)
          ? body.profile
          : "auto",
        judgmentPoints,
        decisionContext,
        sourceCutoffDate,
        materials: docs.map<DeepResearchMaterial>((doc) => ({
          filename: doc.filename,
          docKind: doc.doc_kind,
          extractedText: doc.extracted_text,
          sourceMap: doc.source_map,
        })),
        financialData: project.financial_data,
        externalResearch,
        quantitativeAnalysis,
      })
    : buildGenerationMessages({
        projectName: project.name,
        companyName: project.company_name,
        industry: project.industry,
        stage: project.stage,
        bpText,
        judgmentPoints,
        financialData: project.financial_data,
      });
  const { system, messages } = generation;
  const candidateProfile = "resolvedProfile" in generation
    ? generation.resolvedProfile
    : null;
  const resolvedResearchProfile: ResolvedDeepResearchProfile | null =
    deepResearch &&
    (candidateProfile === "early_stage" || candidateProfile === "comprehensive")
      ? candidateProfile
      : null;
  const validCitations = deepResearch
    ? [
        ...docs.flatMap((doc, documentIndex) =>
          normalizeSourceMap(doc.source_map).map(
            (entry) => `M${documentIndex + 1}·${entry.locator}`
          )
        ),
        ...(externalResearch?.findings.map((_, index) => `E${index + 1}`) ?? []),
      ]
    : [];

  // 注入链：个人画像 → 机构知识沉淀（个人版 / 无能力位时均返回原文）
  const retrievalQuery = [project.name, project.industry, ...judgmentPoints]
    .filter(Boolean)
    .join(" ");
  let injectedSystem = await injectProfile(session.user.id, system, {
    projectName: project.name,
    companyName: project.company_name,
    industry: project.industry,
    stage: project.stage,
    projectJudgments: judgmentPoints,
    taskText: deepResearch
      ? "单项目深度投研：事实、证据、反方、测算、进退决策和尽调清单"
      : "项目分析报告：行业、商业模式、团队、风险和投资结论",
  });
  injectedSystem = await injectOrgKnowledge(scope, retrievalQuery, injectedSystem);
  // 中鉴市场上下文注入（无 org / 无 zjjr_data 能力位 / 无命中时返回原文）
  injectedSystem = await injectMarketContext(scope, retrievalQuery, injectedSystem);

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(
      creds,
      session.user.id,
      deepResearch ? "deep-research-report" : "report-generate"
    ),
    system: injectedSystem,
    messages,
  });

  const res = streamTextResponse(
    generator,
    async (fullText) => {
      if (resolvedResearchProfile) {
        const researchMetadata = buildDeepResearchMetadata({
          content: fullText,
          profile: resolvedResearchProfile,
          validCitations,
          quantitativeAnalysis,
        });
        await query(
          "UPDATE reports SET content = $1, research_metadata = $2 WHERE id = $3",
          [fullText, JSON.stringify(researchMetadata), reportId]
        );
      } else {
        await query("UPDATE reports SET content = $1 WHERE id = $2", [
          fullText,
          reportId,
        ]);
      }
    },
    // 流中途失败：删除从未写入正文的占位行，避免空 draft 堆积（审计 F-17）。
    async () => {
      await query("DELETE FROM reports WHERE id = $1 AND content = ''", [
        reportId,
      ]);
    },
    { usingFreeQuota: creds.usingFreeQuota }
  );
  res.headers.set("X-Report-Id", reportId);
  res.headers.set("X-Report-Kind", reportKind);
  if (
    deepResearch &&
    resolvedResearchProfile
  ) {
    res.headers.set("X-Research-Profile", resolvedResearchProfile);
  }
  return res;
}
