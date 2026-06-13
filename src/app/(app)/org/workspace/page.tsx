import { requireOrg } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { STAGE_LABELS, ALL_STAGES } from "@/lib/stages";
import { OrgWorkspaceClient } from "@/components/org/OrgWorkspaceClient";
import type { OrgDashboardData } from "@/components/org/OrgDashboardView";

export const dynamic = "force-dynamic";

type Tab = "overview" | "members" | "reports";

function num(s: string): number {
  return Number(s) || 0;
}

// 概览四组统计（架构 7.2），仅在开通 org_dashboard 能力位时聚合。
async function getDashboard(orgId: string): Promise<OrgDashboardData> {
  const [funnel, industries, members, trend] = await Promise.all([
    query<{ process_stage: string | null; c: string }>(
      `SELECT process_stage, COUNT(*)::text AS c
         FROM projects WHERE org_id = $1 GROUP BY process_stage`,
      [orgId]
    ),
    query<{ industry: string; c: string }>(
      `SELECT COALESCE(industry, '未标注') AS industry, COUNT(*)::text AS c
         FROM projects WHERE org_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [orgId]
    ),
    query<{ name: string; projects: string; judgments: string; reports: string }>(
      `SELECT u.name,
              COUNT(DISTINCT p.id)::text AS projects,
              COUNT(DISTINCT j.id)::text AS judgments,
              COUNT(DISTINCT r.id)::text AS reports
         FROM org_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN projects p ON p.org_id = m.org_id AND p.owner_id = u.id
         LEFT JOIN investment_judgments j ON j.org_id = m.org_id AND j.user_id = u.id
         LEFT JOIN reports r ON r.org_id = m.org_id AND r.user_id = u.id
        WHERE m.org_id = $1
        GROUP BY u.id, u.name
        ORDER BY u.name ASC`,
      [orgId]
    ),
    query<{ wk: string; c: string }>(
      `SELECT date_trunc('week', created_at) AS wk, COUNT(*)::text AS c
         FROM investment_judgments
        WHERE org_id = $1 AND created_at > NOW() - INTERVAL '12 weeks'
        GROUP BY 1 ORDER BY 1`,
      [orgId]
    ),
  ]);

  // 漏斗按既定阶段顺序展示（含计数为 0 的阶段）。
  const funnelMap = new Map(funnel.map((r) => [r.process_stage ?? "", num(r.c)]));
  return {
    funnel: ALL_STAGES.map((stage) => ({
      label: STAGE_LABELS[stage] ?? stage,
      value: funnelMap.get(stage) ?? 0,
    })),
    industries: industries.map((r) => ({ label: r.industry, value: num(r.c) })),
    members: members.map((m) => ({
      name: m.name,
      projects: num(m.projects),
      judgments: num(m.judgments),
      reports: num(m.reports),
    })),
    trend: trend.map((r) => ({
      week: new Date(r.wk).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      }),
      value: num(r.c),
    })),
  };
}

// 组织工作台：org 成员一级入口。概览 / 成员与设置始终可访问；
// 概览统计与对外报告各自按能力位（org_dashboard / lp_reports / assoc_report）控制。
export default async function OrgWorkspacePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrg();
  const isAdmin = ctx.role === "admin";

  const tabRaw =
    typeof searchParams?.tab === "string" ? searchParams.tab : "overview";
  const initialTab: Tab =
    tabRaw === "members" || tabRaw === "reports" ? (tabRaw as Tab) : "overview";

  const [orgRows, memberRows] = await Promise.all([
    query<{
      name: string;
      description: string | null;
      created_at: string;
    }>(
      "SELECT name, description, created_at FROM orgs WHERE id = $1",
      [ctx.orgId]
    ),
    query<{
      user_id: string;
      role: string;
      name: string;
      email: string | null;
      phone: string | null;
      joined_at: string;
    }>(
      `SELECT m.user_id, m.role, u.name, u.email, u.phone,
              m.created_at AS joined_at
         FROM org_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1
        ORDER BY m.created_at ASC`,
      [ctx.orgId]
    ),
  ]);

  const invitationRows = isAdmin
    ? await query<{
        id: string;
        identifier: string;
        role: string;
        status: string;
        expires_at: string;
        created_at: string;
      }>(
        `SELECT id, identifier, role, status, expires_at, created_at
           FROM org_invitations
          WHERE org_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [ctx.orgId]
      )
    : [];

  // 概览统计守门同 P4 /org/dashboard：partner+ 且开通 org_dashboard。
  // analyst 仍可进入工作台/概览（看能力位状态），但不展示统计看板。
  const canDashboard =
    (ctx.role === "partner" || ctx.role === "admin") &&
    ctx.capabilities["org_dashboard"] === true;
  const dashboard = canDashboard ? await getDashboard(ctx.orgId) : null;

  const org = orgRows[0];

  return (
    <OrgWorkspaceClient
      orgName={org?.name ?? ctx.orgName}
      myRole={ctx.role}
      myUserId={ctx.userId}
      capabilities={ctx.capabilities}
      dashboard={dashboard}
      org={{
        id: ctx.orgId,
        name: org?.name ?? ctx.orgName,
        description: org?.description ?? null,
        createdAt: org?.created_at ?? "",
      }}
      members={memberRows.map((m) => ({
        userId: m.user_id,
        role: m.role,
        name: m.name,
        email: m.email,
        phone: m.phone,
        joinedAt: m.joined_at,
      }))}
      invitations={invitationRows}
      initialTab={initialTab}
    />
  );
}
