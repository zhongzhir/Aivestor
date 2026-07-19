import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ReportView } from "@/components/project/ReportView";
import {
  buildAccessScope,
  assertProjectAccess,
  scopedProjectChildWhere,
  ResourceForbiddenError,
} from "@/lib/resourceAccess";

export const dynamic = "force-dynamic";

interface ReportRow {
  id: string;
  content: string;
  conversation_history: { instruction: string; ts: string }[];
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { generate?: string; reportId?: string };
}) {
  const session = await requireAuth();

  // 归属校验（read）：个人项目仅创建者；组织项目按角色（与 archive / export
  // 路由同一套 scoped 逻辑，修复入口间权限不一致——审计 F-03）。
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch (e) {
    if (e instanceof ResourceForbiddenError) notFound();
    throw e;
  }

  // 访问已校验，按 id 取项目字段即可。
  const projects = await query<{
    name: string;
    financial_data: import("@/lib/types").FinancialData | null;
  }>("SELECT name, financial_data FROM projects WHERE id = $1 AND deleted_at IS NULL", [params.id]);
  if (projects.length === 0) notFound();

  // 报告可见性跟随项目；analyst 不可见 kind='committee'（与 archive / export 一致）。
  // 指定了 reportId 时打开该条报告；否则回退到最新报告（向后兼容）。
  let report: ReportRow | undefined;
  if (searchParams.reportId) {
    const child = scopedProjectChildWhere(scope, 3, {
      alias: "r",
      excludeMergedForAnalyst: true,
    });
    const specific = await query<ReportRow>(
      `SELECT r.id, r.content, r.conversation_history
         FROM reports r
        WHERE r.id = $1 AND r.project_id = $2 AND ${child.sql}`,
      [searchParams.reportId, params.id, ...child.params]
    );
    report = specific[0];
  }
  if (!report) {
    const child = scopedProjectChildWhere(scope, 2, {
      alias: "r",
      excludeMergedForAnalyst: true,
    });
    const reports = await query<ReportRow>(
      `SELECT r.id, r.content, r.conversation_history
         FROM reports r
        WHERE r.project_id = $1 AND ${child.sql}
        ORDER BY r.updated_at DESC LIMIT 1`,
      [params.id, ...child.params]
    );
    report = reports[0];
  }

  return (
    <ReportView
      projectId={params.id}
      projectName={projects[0].name}
      initialReportId={report?.id ?? null}
      initialContent={report?.content ?? ""}
      initialHistory={report?.conversation_history ?? []}
      initialFinancialData={projects[0].financial_data}
      autoGenerate={searchParams.generate === "1"}
    />
  );
}
