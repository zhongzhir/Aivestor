import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { LpReportClient } from "@/components/org/LpReportClient";

export const dynamic = "force-dynamic";

// LP 报告（架构 7.3）：partner+ 且能力位 lp_reports；否则整页不可达。
export default async function LpReportsPage() {
  const ctx = await requireOrg("partner");
  if (ctx.capabilities["lp_reports"] !== true) redirect("/dashboard");

  // 在投项目供"项目范围"选择（可选；不选则覆盖全部在投项目）。
  const invested = await query<{ id: string; name: string }>(
    `SELECT id, name FROM projects
      WHERE org_id = $1 AND deleted_at IS NULL AND status = 'invested'
      ORDER BY name ASC`,
    [ctx.orgId]
  );

  return (
    <LpReportClient
      orgName={ctx.orgName}
      investedProjects={invested.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
