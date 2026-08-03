import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { stripSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { BRAND } from "@/lib/brand";
import { buildPptReportBuffer } from "@/lib/ppt-report";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

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
  }>(
    `SELECT r.title, r.content, r.created_at,
            p.name AS project_name, p.industry, p.stage
       FROM reports r
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }

  const report = rows[0];
  const markdown = stripSourceBadges(
    extractConfidence(report.content).cleanContent
  );
  const buffer = await buildPptReportBuffer({
    markdown,
    brand: BRAND,
    metadata: {
      title: report.title,
      projectName: report.project_name,
      industry: report.industry,
      stage: report.stage,
      reportDate: new Date(report.created_at),
    },
  });
  const filename = encodeURIComponent(
    `${report.project_name}-${BRAND.shortProductName}-报告.pptx`
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
