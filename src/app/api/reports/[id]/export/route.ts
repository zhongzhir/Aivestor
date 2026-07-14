import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { stripSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { buildDocxBuffer } from "@/lib/docx";
import { buildFormalDocxBuffer } from "@/lib/formal-report/docx";
import { inferFormalReportProfile } from "@/lib/formal-report/profiles";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

// GET /api/reports/[id]/export — 导出 Word 文档
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 报告可见性跟随项目；analyst 不可见 kind='committee'。个人版退化等价。
  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    alias: "r",
    excludeMergedForAnalyst: true,
  });
  const rows = await query<{
    title: string;
    content: string;
    kind: string | null;
    project_name: string | null;
    organization_name: string | null;
    industry: string | null;
    stage: string | null;
    version: number | null;
    updated_at: string;
  }>(
    `SELECT r.title, r.content, r.kind, r.version, r.updated_at,
            p.name AS project_name, p.industry, p.stage,
            o.name AS organization_name
       FROM reports r
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN orgs o ON o.id = r.org_id
      WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  const report = rows[0];

  // 文件名前缀按 kind 区分，兜底用 title
  const kindPrefixMap: Record<string, string> = {
    term_sheet: "TermSheet",
    brief: "简要分析",
    analysis: "项目分析报告",
    committee: "投决会报告",
    lp_report: "LP报告",
    post_investment: "投后报告",
  };
  const prefix =
    (report.kind && kindPrefixMap[report.kind]) || "项目分析报告";
  const dateStr = new Date().toISOString().slice(0, 10);
  const docName = report.project_name
    ? `${prefix}_${report.project_name}_${dateStr}`
    : report.title;

  // 导出前剥离溯源标记 [src:doc]/[src:data]/[src:ai]——它们仅用于前端徽章渲染，
  // 在 Word 导出中是纯文本噪声。对全部 kind 统一剥离，自然覆盖对外文档 lp_report。
  const cleanContent = stripSourceBadges(
    extractConfidence(report.content).cleanContent
  );
  const url = new URL(req.url);
  const formal = url.searchParams.get("formal") === "1";
  const requestedProfile = url.searchParams.get("profile");
  const profile = inferFormalReportProfile(report.kind, requestedProfile);
  const buffer = formal
    ? await buildFormalDocxBuffer({
        profile,
        metadata: {
          title: report.title,
          projectName: report.project_name,
          organizationName: report.organization_name,
          industry: report.industry,
          stage: report.stage,
          reportDate: new Date(report.updated_at),
          version: report.version,
        },
        markdown: cleanContent,
      })
    : await buildDocxBuffer(report.title, cleanContent);
  if (report.kind === "post_investment") {
    await query(
      `INSERT INTO post_investment_report_exports (report_id, user_id, format)
       VALUES ($1, $2, 'docx')`,
      [params.id, session.user.id]
    );
  }
  const filename = encodeURIComponent(
    `${docName}${formal ? `_${profile.label}_正式版` : ""}.docx`
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
