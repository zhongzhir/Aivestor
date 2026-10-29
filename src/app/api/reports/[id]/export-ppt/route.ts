import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { extractConfidence } from "@/lib/reportConfidence";
import { extractEvidenceLedger } from "@/lib/deepResearchWorkpaper";
import { BRAND } from "@/lib/brand";
import { buildPptReportBuffer } from "@/lib/ppt-report";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";
import type { FinancialData } from "@/lib/types";
import type { DeepResearchExternalResult } from "@/lib/deepResearchExternal";
import { reportExportSources } from "@/lib/reportExportSources";

// GET /api/reports/[id]/export-ppt — 从已保存报告内容生成 PPT，不重新调用 AI。
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    alias: "r",
    excludeMergedForAnalyst: true,
  });
  const rows = await query<{
    title: string;
    content: string;
    project_name: string;
    industry: string | null;
    stage: string | null;
    created_at: string;
    kind: string | null;
    financial_data: FinancialData | null;
    project_id: string;
  }>(
    `SELECT r.title, r.content, r.created_at, r.kind, r.project_id,
            p.name AS project_name, p.industry, p.stage, p.financial_data
       FROM reports r
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }

  const report = rows[0];
  const externalRows = report.kind === "deep_research"
    ? await query<{ external_research: DeepResearchExternalResult | null }>(
        `SELECT result->'externalResearch' AS external_research
           FROM deep_research_jobs
          WHERE (report_id = $1 OR (project_id = $2 AND status = 'completed'))
            AND result ? 'externalResearch'
          ORDER BY CASE WHEN report_id = $1 THEN 0 ELSE 1 END,
                   completed_at DESC NULLS LAST
          LIMIT 1`,
        [params.id, report.project_id]
      )
    : [];
  const externalSources = reportExportSources(
    externalRows[0]?.external_research
  );
  const markdown = extractConfidence(
    extractEvidenceLedger(report.content).cleanContent
  ).cleanContent;
  const buffer = await buildPptReportBuffer({
    markdown,
    brand: BRAND,
    mode: report.kind === "deep_research" ? "deep_research_ic" : "full",
    financialData: report.financial_data,
    externalSources,
    metadata: {
      title: report.title,
      projectName: report.project_name,
      industry: report.industry,
      stage: report.stage,
      reportDate: new Date(report.created_at),
    },
  });
  const filename = encodeURIComponent(
    `${report.project_name}-${BRAND.shortProductName}-${report.kind === "deep_research" ? "投委会摘要_审核稿" : "报告"}.pptx`
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
