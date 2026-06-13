// 能力位只读展示（架构 1.3 清单）。原位于组织设置页底部，
// 导航整合后迁移到「组织工作台 · 概览」tab。纯展示，无交互。

// 能力位显示名（未知键原样展示）
const CAP_LABEL: Record<string, string> = {
  collaboration: "组织协作",
  org_knowledge: "机构知识沉淀",
  org_dashboard: "机构统计分析",
  lp_reports: "LP 报告",
  assoc_report: "协会报告辅助",
  zjjr_data: "中鉴数据增强",
  data_apps: "数据应用",
  max_members: "成员数上限",
};

export function OrgCapabilityStatus({
  capabilities,
}: {
  capabilities: Record<string, boolean | number>;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="text-sm font-medium text-ink">已开通能力</h2>
      <p className="mt-1 text-xs text-ink-faint">
        只读展示。套餐调整请联系平台。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {Object.entries(capabilities).map(([key, value]) => (
          <div
            key={key}
            className="rounded border border-line bg-surface px-3 py-2 text-sm"
          >
            <span className="text-ink-soft">{CAP_LABEL[key] ?? key}</span>
            <span className="ml-2 text-ink">
              {typeof value === "number"
                ? value
                : value === true
                  ? "✓ 已开通"
                  : "— 未开通"}
            </span>
          </div>
        ))}
        {Object.keys(capabilities).length === 0 && (
          <div className="text-sm text-ink-faint">
            暂未配置能力，请联系平台
          </div>
        )}
      </div>
    </section>
  );
}
