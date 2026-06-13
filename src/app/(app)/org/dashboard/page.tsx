import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { STAGE_LABELS, ALL_STAGES } from "@/lib/stages";

export const dynamic = "force-dynamic";

interface FunnelRow {
  process_stage: string | null;
  c: string;
}
interface IndustryRow {
  industry: string;
  c: string;
}
interface MemberRow {
  name: string;
  projects: string;
  judgments: string;
  reports: string;
}
interface TrendRow {
  wk: string;
  c: string;
}

// 机构 Dashboard（架构 7.2）：deal flow 漏斗 / 赛道分布 / 成员活跃度 / 判断趋势。
// Server Component 直查 + Promise.all，照搬 admin dashboard 模式，仅把全表聚合换成 org 过滤。
// requireOrg("partner") + 能力位 org_dashboard；个人版/无能力位整页不可达。
async function getStats(orgId: string) {
  const [funnel, industries, members, trend] = await Promise.all([
    query<FunnelRow>(
      `SELECT process_stage, COUNT(*)::text AS c
         FROM projects WHERE org_id = $1 GROUP BY process_stage`,
      [orgId]
    ),
    query<IndustryRow>(
      `SELECT COALESCE(industry, '未标注') AS industry, COUNT(*)::text AS c
         FROM projects WHERE org_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [orgId]
    ),
    query<MemberRow>(
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
    query<TrendRow>(
      `SELECT date_trunc('week', created_at) AS wk, COUNT(*)::text AS c
         FROM investment_judgments
        WHERE org_id = $1 AND created_at > NOW() - INTERVAL '12 weeks'
        GROUP BY 1 ORDER BY 1`,
      [orgId]
    ),
  ]);
  return { funnel, industries, members, trend };
}

function num(s: string): number {
  return Number(s) || 0;
}

// 横向条：value 相对 max 的占比。
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-xs text-ink-soft" title={label}>
        {label}
      </span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
        <div
          className="h-full rounded bg-[#0D1B3E]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function OrgDashboardPage() {
  const ctx = await requireOrg("partner");
  if (ctx.capabilities["org_dashboard"] !== true) redirect("/dashboard");

  const s = await getStats(ctx.orgId);

  // 漏斗按既定阶段顺序展示（含计数为 0 的阶段，呈现完整漏斗）。
  const funnelMap = new Map(s.funnel.map((r) => [r.process_stage ?? "", num(r.c)]));
  const funnel = ALL_STAGES.map((stage) => ({
    label: STAGE_LABELS[stage] ?? stage,
    value: funnelMap.get(stage) ?? 0,
  }));
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  const industries = s.industries.map((r) => ({
    label: r.industry,
    value: num(r.c),
  }));
  const industryMax = Math.max(1, ...industries.map((i) => i.value));

  const trend = s.trend.map((r) => ({
    week: new Date(r.wk).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    }),
    value: num(r.c),
  }));
  const trendMax = Math.max(1, ...trend.map((t) => t.value));

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">机构 Dashboard</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {ctx.orgName} · 服务端直查，刷新即更新
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel title="Deal Flow 漏斗（按流程阶段）">
          <div className="space-y-2">
            {funnel.map((f) => (
              <Bar key={f.label} label={f.label} value={f.value} max={funnelMax} />
            ))}
          </div>
        </Panel>

        <Panel title="赛道分布（前 10）">
          {industries.length === 0 ? (
            <p className="text-sm text-ink-faint">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {industries.map((i) => (
                <Bar
                  key={i.label}
                  label={i.label}
                  value={i.value}
                  max={industryMax}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="成员活跃度">
          {s.members.length === 0 ? (
            <p className="text-sm text-ink-faint">暂无成员</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="pb-2 font-medium">成员</th>
                  <th className="pb-2 text-right font-medium">项目</th>
                  <th className="pb-2 text-right font-medium">判断</th>
                  <th className="pb-2 text-right font-medium">报告</th>
                </tr>
              </thead>
              <tbody>
                {s.members.map((m) => (
                  <tr key={m.name} className="border-b border-line/60">
                    <td className="py-2 text-ink">{m.name}</td>
                    <td className="py-2 text-right tabular-nums text-ink-soft">
                      {num(m.projects)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-soft">
                      {num(m.judgments)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-soft">
                      {num(m.reports)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="判断数量趋势（近 12 周）">
          {trend.length === 0 ? (
            <p className="text-sm text-ink-faint">近 12 周暂无判断记录</p>
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {trend.map((t) => (
                <div
                  key={t.week}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${t.week}：${t.value} 条`}
                >
                  <div
                    className="w-full rounded-t bg-[#FF6B35]"
                    style={{ height: `${(t.value / trendMax) * 100}%` }}
                  />
                  <span className="text-[10px] text-ink-faint">{t.week}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
