"use client";

import { useState } from "react";
import Link from "next/link";
import { OrgSettingsClient } from "./OrgSettingsClient";
import { OrgCapabilityStatus } from "./OrgCapabilityStatus";
import { OrgDashboardView, type OrgDashboardData } from "./OrgDashboardView";

type Tab = "overview" | "members" | "reports";

interface Member {
  userId: string;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
}
interface Invitation {
  id: string;
  identifier: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
}

interface Props {
  orgName: string;
  myRole: string;
  myUserId: string;
  capabilities: Record<string, boolean | number>;
  dashboard: OrgDashboardData | null;
  org: { id: string; name: string; description: string | null; createdAt: string };
  members: Member[];
  invitations: Invitation[];
  initialTab: Tab;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "members", label: "成员与设置" },
  { key: "reports", label: "对外报告" },
];

export function OrgWorkspaceClient({
  orgName,
  myRole,
  myUserId,
  capabilities,
  dashboard,
  org,
  members,
  invitations,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  function selectTab(next: Tab) {
    setTab(next);
    // 更新 URL（可深链/分享）但不触发服务端重渲染。
    window.history.replaceState(null, "", `/org/workspace?tab=${next}`);
  }

  const lpEnabled = capabilities["lp_reports"] === true;
  const assocEnabled = capabilities["assoc_report"] === true && myRole === "admin";

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">组织工作台</h1>
      <p className="mt-1 text-sm text-ink-soft">{orgName}</p>

      {/* 分段控件 */}
      <div className="mt-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-[#0D1B3E] font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 概览 */}
      {tab === "overview" && (
        <div className="mt-6 space-y-6">
          {dashboard ? (
            <OrgDashboardView data={dashboard} />
          ) : (
            <div className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-soft">
              暂无统计看板（需管理层角色并开通「机构统计分析」能力）。
            </div>
          )}
          <OrgCapabilityStatus capabilities={capabilities} />
        </div>
      )}

      {/* 成员与设置 */}
      {tab === "members" && (
        <div className="mt-6">
          <OrgSettingsClient
            org={org}
            myUserId={myUserId}
            myRole={myRole}
            capabilities={capabilities}
            members={members}
            invitations={invitations}
            embedded
            showCapabilities={false}
          />
        </div>
      )}

      {/* 对外报告 */}
      {tab === "reports" && (
        <div className="mt-6 space-y-3">
          <ReportRow
            title="LP 报告"
            desc="聚合投后数据，按模板生成 LP 报告并导出"
            href="/org/lp-reports"
            enabled={lpEnabled}
            disabledHint="组织未开通 LP 报告能力"
          />
          <ReportRow
            title="协会报告底稿"
            desc="信息聚合底稿，辅助起草，非代报送"
            href="/org/assoc-report"
            enabled={assocEnabled}
            disabledHint={
              capabilities["assoc_report"] === true
                ? "仅管理员可访问"
                : "组织未开通协会报告能力"
            }
          />
          <p className="pt-2 text-xs text-ink-faint">更多报告类型即将上线</p>
        </div>
      )}
    </div>
  );
}

function ReportRow({
  title,
  desc,
  href,
  enabled,
  disabledHint,
}: {
  title: string;
  desc: string;
  href: string;
  enabled: boolean;
  disabledHint: string;
}) {
  if (!enabled) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 opacity-60">
        <div>
          <p className="text-sm font-medium text-ink-soft">{title}</p>
          <p className="mt-0.5 text-xs text-ink-faint">{desc}</p>
        </div>
        <span className="shrink-0 text-xs text-ink-faint">{disabledHint}</span>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3 transition-colors hover:border-[#0D1B3E]"
    >
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{desc}</p>
      </div>
      <span className="shrink-0 text-sm text-accent">进入 →</span>
    </Link>
  );
}
