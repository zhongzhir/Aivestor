// 机构 Dashboard 四组统计的纯展示组件（架构 7.2）。
// 数据在服务端聚合后传入；本组件只负责渲染（漏斗 / 赛道 / 成员活跃度 / 趋势）。

export interface OrgDashboardData {
  funnel: { label: string; value: number }[];
  industries: { label: string; value: number }[];
  members: { name: string; projects: number; judgments: number; reports: number }[];
  trend: { week: string; value: number }[];
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
        <div className="h-full rounded bg-[#0D1B3E]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function OrgDashboardView({ data }: { data: OrgDashboardData }) {
  const funnelMax = Math.max(1, ...data.funnel.map((f) => f.value));
  const industryMax = Math.max(1, ...data.industries.map((i) => i.value));
  const trendMax = Math.max(1, ...data.trend.map((t) => t.value));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Deal Flow 漏斗（按流程阶段）">
        <div className="space-y-2">
          {data.funnel.map((f) => (
            <Bar key={f.label} label={f.label} value={f.value} max={funnelMax} />
          ))}
        </div>
      </Panel>

      <Panel title="赛道分布（前 10）">
        {data.industries.length === 0 ? (
          <p className="text-sm text-ink-faint">暂无数据</p>
        ) : (
          <div className="space-y-2">
            {data.industries.map((i) => (
              <Bar key={i.label} label={i.label} value={i.value} max={industryMax} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="成员活跃度">
        {data.members.length === 0 ? (
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
              {data.members.map((m) => (
                <tr key={m.name} className="border-b border-line/60">
                  <td className="py-2 text-ink">{m.name}</td>
                  <td className="py-2 text-right tabular-nums text-ink-soft">
                    {m.projects}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-soft">
                    {m.judgments}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-soft">
                    {m.reports}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="判断数量趋势（近 12 周）">
        {data.trend.length === 0 ? (
          <p className="text-sm text-ink-faint">近 12 周暂无判断记录</p>
        ) : (
          <div className="flex h-40 items-end gap-1.5">
            {data.trend.map((t) => (
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
  );
}
