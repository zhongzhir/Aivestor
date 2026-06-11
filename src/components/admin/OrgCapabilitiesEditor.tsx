"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 平台 admin：org 能力位编辑器（逐项开关 + 数字位 + 预设能力包一键应用 + 停用/启用）。
//
// 红线提醒：预设能力包（协作版/数据增强版）只是运营侧的能力位组合快捷方式，
// 业务代码只认能力位本身，不认这些名字。

// 能力位清单（架构文档 1.3 首批）
const BOOL_CAPS: { key: string; label: string }[] = [
  { key: "collaboration", label: "组织协作" },
  { key: "org_knowledge", label: "机构知识沉淀" },
  { key: "org_dashboard", label: "机构统计分析" },
  { key: "lp_reports", label: "LP 报告" },
  { key: "assoc_report", label: "协会报告辅助" },
  { key: "zjjr_data", label: "中鉴数据增强" },
  { key: "data_apps", label: "数据应用" },
];

// 预设能力包（架构文档 1.3 映射表，写死在前端常量；个人版无 org 不适用）
const PRESETS: { name: string; caps: Record<string, boolean | number> }[] = [
  {
    name: "机构协作版预设",
    caps: {
      collaboration: true,
      org_knowledge: true,
      org_dashboard: true,
      lp_reports: true,
      assoc_report: true,
      zjjr_data: false,
      data_apps: false,
      max_members: 10,
    },
  },
  {
    name: "机构数据增强版预设",
    caps: {
      collaboration: true,
      org_knowledge: true,
      org_dashboard: true,
      lp_reports: true,
      assoc_report: true,
      zjjr_data: true,
      data_apps: true,
      max_members: 30,
    },
  },
];

interface Props {
  orgId: string;
  initialCapabilities: Record<string, boolean | number>;
  initialIsActive: boolean;
}

export function OrgCapabilitiesEditor({
  orgId,
  initialCapabilities,
  initialIsActive,
}: Props) {
  const router = useRouter();
  const [caps, setCaps] = useState<Record<string, boolean | number>>(
    initialCapabilities
  );
  const [isActive, setIsActive] = useState(initialIsActive);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "保存失败");
        return false;
      }
      setMsg("已保存（缓存已清除，即时生效）");
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const maxMembers =
    typeof caps.max_members === "number" ? caps.max_members : 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-900">能力位配置</div>
        <button
          onClick={async () => {
            if (await patch({ isActive: !isActive })) {
              setIsActive(!isActive);
            }
          }}
          disabled={busy}
          className={`rounded px-3 py-1.5 text-xs text-white disabled:opacity-50 ${
            isActive
              ? "bg-red-600 hover:bg-red-500"
              : "bg-green-700 hover:bg-green-600"
          }`}
        >
          {isActive ? "停用组织" : "启用组织"}
        </button>
      </div>

      {/* 预设能力包 */}
      <div className="mt-3 flex gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => setCaps(p.caps)}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            应用{p.name}
          </button>
        ))}
        <span className="self-center text-[11px] text-gray-400">
          预设仅填充下方开关，需点保存生效
        </span>
      </div>

      {/* 逐项开关 */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {BOOL_CAPS.map((c) => (
          <label
            key={c.key}
            className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={caps[c.key] === true}
              onChange={(e) =>
                setCaps((prev) => ({ ...prev, [c.key]: e.target.checked }))
              }
            />
            <span className="text-gray-700">{c.label}</span>
            <span className="ml-auto text-[10px] text-gray-400">{c.key}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm">
          <span className="text-gray-700">成员数上限</span>
          <input
            type="number"
            min={0}
            value={maxMembers}
            onChange={(e) =>
              setCaps((prev) => ({
                ...prev,
                max_members: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              }))
            }
            className="ml-auto w-20 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <span className="text-[10px] text-gray-400">max_members</span>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => patch({ capabilities: caps })}
          disabled={busy}
          className="rounded bg-gray-900 px-4 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          保存能力位
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
