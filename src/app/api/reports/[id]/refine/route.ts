import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  buildRefineMessages,
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";
import {
  buildDeepResearchMetadata,
  type DeepResearchMetadata,
} from "@/lib/deepResearchWorkpaper";
import { resolveDeepResearchProfile } from "@/lib/deepResearch";
import { normalizeSourceMap } from "@/lib/sourceMap";

export const maxDuration = 120;

interface ReportRow {
  content: string;
  version: number;
  conversation_history: { instruction: string; ts: string }[];
  kind: string;
  project_id: string;
  research_metadata: DeepResearchMetadata | null;
  project_stage: string | null;
}

interface ExternalResearchRow {
  external_research: { findings?: unknown[] } | null;
}

// POST /api/reports/[id]/refine — 按自然语言指令修改报告（流式）
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

  let body: { instruction?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json({ error: "请输入修改指令" }, { status: 400 });
  }

  // 报告可见性跟随项目；analyst 不可见 kind='committee'。
  // 个人版退化为 "user_id = $2"，与现状等价。
  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    alias: "r",
    excludeMergedForAnalyst: true,
  });
  const reports = await query<ReportRow>(
    `SELECT r.content, r.version, r.conversation_history, r.kind, r.project_id,
            r.research_metadata, p.stage AS project_stage
       FROM reports r
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (reports.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  const report = reports[0];
  const deepResearch = report.kind === "deep_research";
  const researchProfile = deepResearch
    ? report.research_metadata?.profile ?? resolveDeepResearchProfile("auto", report.project_stage)
    : null;
  let validCitations: string[] = [];
  if (deepResearch) {
    validCitations = (
        await query<{ source_map: unknown }>(
          `SELECT source_map FROM documents
            WHERE project_id = $1 AND extracted_text IS NOT NULL
              AND doc_kind = ANY($2::text[])
            ORDER BY created_at ASC`,
          [report.project_id, ["bp", "research", "financial_model", "news", "other"]]
        )
      ).flatMap((doc, documentIndex) =>
        normalizeSourceMap(doc.source_map).map(
          (entry) => `M${documentIndex + 1}·${entry.locator}`
        )
      );
    const externalRows = await query<ExternalResearchRow>(
      `SELECT result->'externalResearch' AS external_research
         FROM deep_research_jobs
        WHERE (report_id = $1 OR (project_id = $2 AND status = 'completed'))
          AND result ? 'externalResearch'
        ORDER BY CASE WHEN report_id = $1 THEN 0 ELSE 1 END,
                 completed_at DESC NULLS LAST
        LIMIT 1`,
      [params.id, report.project_id]
    );
    const externalCount = Array.isArray(externalRows[0]?.external_research?.findings)
      ? externalRows[0].external_research!.findings!.length
      : 0;
    validCitations.push(...Array.from({ length: externalCount }, (_, index) => `E${index + 1}`));
  }

  const { system, messages } = buildRefineMessages({
    currentReport: report.content,
    instruction,
  });

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "report-refine"),
    system: await injectProfile(session.user.id, system, {
      explicitInstruction: instruction,
    }),
    messages,
  });

  return streamTextResponse(generator, async (fullText) => {
    const history = [
      ...report.conversation_history,
      { instruction, ts: new Date().toISOString() },
    ];
    if (researchProfile) {
      const metadata = buildDeepResearchMetadata({
        content: fullText,
        profile: researchProfile,
        validCitations,
      });
      await query(
        `UPDATE reports
            SET content = $1, version = $2, conversation_history = $3,
                research_metadata = $4
          WHERE id = $5`,
        [fullText, report.version + 1, JSON.stringify(history), JSON.stringify(metadata), params.id]
      );
    } else {
      await query(
        `UPDATE reports
            SET content = $1, version = $2, conversation_history = $3
          WHERE id = $4`,
        [fullText, report.version + 1, JSON.stringify(history), params.id]
      );
    }
  });
}
