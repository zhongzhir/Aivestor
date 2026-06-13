import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { stripSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { buildDocxBuffer } from "@/lib/docx";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

// GET /api/reports/[id]/export — 导出 Word 文档
export async function GET(
  _req: Request,
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
  }>(
    `SELECT r.title, r.content, r.kind, p.name AS project_name
       FROM reports r
       LEFT JOIN projects p ON p.id = r.project_id
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
  };
  const prefix =
    (report.kind && kindPrefixMap[report.kind]) || "项目分析报告";
  const dateStr = new Date().toISOString().slice(0, 10);
  const docName = report.project_name
    ? `${prefix}_${report.project_name}_${dateStr}`
    : report.title;

  const buffer = await buildDocxBuffer(
    report.title,
    stripSourceBadges(extractConfidence(report.content).cleanContent)
  );
  const filename = encodeURIComponent(`${docName}.docx`);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
