"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 组织设置交互层。服务端已按角色裁剪数据（非 admin 拿不到邀请列表），
// 本组件的 isAdmin 分支只是 UI 渲染开关，权限判断在 API 层。

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  partner: "合伙人",
  analyst: "分析师",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  accepted: "已接受",
  revoked: "已撤销",
  expired: "已过期",
};

// 能力位显示名（与架构文档 1.3 清单一致；未知键原样展示）
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
  org: {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
  };
  myUserId: string;
  myRole: string;
  capabilities: Record<string, boolean | number>;
  members: Member[];
  invitations: Invitation[];
  // 嵌入「组织工作台」tab 时：去掉页级外壳（标题/边距），由工作台统一提供。
  embedded?: boolean;
  // 能力位只读区是否在此渲染（导航整合后改由工作台「概览」tab 展示，故默认隐藏）。
  showCapabilities?: boolean;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("zh-CN");
}

export function OrgSettingsClient({
  org,
  myUserId,
  myRole,
  capabilities,
  members,
  invitations,
  embedded = false,
  showCapabilities = true,
}: Props) {
  const router = useRouter();
  const isAdmin = myRole === "admin";

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 组织信息编辑
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");

  // 邀请表单
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState("analyst");

  // 移除成员时的交接弹层状态
  const [transferFor, setTransferFor] = useState<{
    userId: string;
    name: string;
    projects: { id: string; name: string }[];
  } | null>(null);
  const [transferTo, setTransferTo] = useState("");

  async function call(
    url: string,
    init: RequestInit
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok && res.status !== 409) {
        setError(typeof data.error === "string" ? data.error : "操作失败");
        return { ok: false, data };
      }
      return { ok: res.ok, data };
    } catch {
      setError("网络错误，请重试");
      return { ok: false, data: {} };
    } finally {
      setBusy(false);
    }
  }

  async function saveOrgInfo() {
    const r = await call("/api/org", {
      method: "PATCH",
      body: JSON.stringify({ name, description }),
    });
    if (r.ok) router.refresh();
  }

  async function changeRole(userId: string, role: string) {
    const r = await call(`/api/org/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    if (r.ok) router.refresh();
  }

  async function removeMember(member: Member, transferOwnerTo?: string) {
    const r = await call(`/api/org/members/${member.userId}`, {
      method: "DELETE",
      body: JSON.stringify(transferOwnerTo ? { transferOwnerTo } : {}),
    });
    if (r.ok) {
      setTransferFor(null);
      setTransferTo("");
      router.refresh();
      return;
    }
    // 409：名下有组织项目，需指定接收人（架构文档 1.5）
    if (Array.isArray(r.data.projects)) {
      setTransferFor({
        userId: member.userId,
        name: member.name,
        projects: r.data.projects as { id: string; name: string }[],
      });
    }
  }

  async function sendInvite() {
    const r = await call("/api/org/invitations", {
      method: "POST",
      body: JSON.stringify({ identifier: inviteIdentifier, role: inviteRole }),
    });
    if (r.ok) {
      setInviteIdentifier("");
      router.refresh();
    }
  }

  async function revokeInvite(id: string) {
    const r = await call(`/api/org/invitations/${id}`, { method: "DELETE" });
    if (r.ok) router.refresh();
  }

  return (
    <div className={embedded ? "" : "mx-auto max-w-doc px-6 py-12"}>
      {!embedded && (
        <>
          <h1 className="text-xl font-semibold text-ink">组织设置</h1>
          <p className="mt-1 text-xs text-ink-faint">
            {org.name} · 我的角色：{ROLE_LABEL[myRole] ?? myRole} · 创建于{" "}
            {fmtDate(org.createdAt)}
          </p>
        </>
      )}

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 组织信息（admin 可编辑，其他角色只读） */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-ink">组织信息</h2>
        {isAdmin ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-ink-faint">组织名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-72 rounded border border-line px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-faint">组织简介</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full max-w-xl rounded border border-line px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <button
              onClick={saveOrgInfo}
              disabled={busy}
              className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              保存
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            {org.description || "（组织未填写简介）"}
          </p>
        )}
      </section>

      {/* 成员列表 */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-sm font-medium text-ink">
          成员（{members.length} 人）
        </h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2 font-normal">姓名</th>
                <th className="px-4 py-2 font-normal">邮箱 / 手机</th>
                <th className="px-4 py-2 font-normal">角色</th>
                <th className="px-4 py-2 font-normal">加入时间</th>
                {isAdmin && <th className="px-4 py-2 font-normal">操作</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b border-line/60">
                  <td className="px-4 py-2 text-ink">
                    {m.name}
                    {m.userId === myUserId && (
                      <span className="ml-1 text-xs text-ink-faint">(我)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {m.email ?? m.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {isAdmin && m.userId !== myUserId ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => changeRole(m.userId, e.target.value)}
                        className="rounded border border-line px-2 py-1 text-xs"
                      >
                        <option value="admin">管理员</option>
                        <option value="partner">合伙人</option>
                        <option value="analyst">分析师</option>
                      </select>
                    ) : (
                      <span className="text-ink-soft">
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-faint">
                    {fmtDate(m.joinedAt)}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      {m.userId !== myUserId && (
                        <button
                          onClick={() => removeMember(m)}
                          disabled={busy}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          移除
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 交接弹层：移除成员名下有组织项目时（409 触发） */}
      {transferFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[28rem] rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-sm font-medium text-ink">
              移除 {transferFor.name} 前需交接项目
            </h3>
            <p className="mt-2 text-xs text-ink-faint">
              该成员名下有 {transferFor.projects.length} 个组织项目，
              请选择接收人后再移除：
            </p>
            <ul className="mt-2 max-h-32 overflow-auto text-xs text-ink-soft">
              {transferFor.projects.map((p) => (
                <li key={p.id}>· {p.name}</li>
              ))}
            </ul>
            <select
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              className="mt-3 w-full rounded border border-line px-2 py-1.5 text-sm"
            >
              <option value="">选择接收人…</option>
              {members
                .filter((m) => m.userId !== transferFor.userId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}（{ROLE_LABEL[m.role] ?? m.role}）
                  </option>
                ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setTransferFor(null);
                  setTransferTo("");
                }}
                className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-slate-50"
              >
                取消
              </button>
              <button
                disabled={!transferTo || busy}
                onClick={() => {
                  const member = members.find(
                    (m) => m.userId === transferFor.userId
                  );
                  if (member) removeMember(member, transferTo);
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                交接并移除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 邀请管理（仅 admin） */}
      {isAdmin && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="text-sm font-medium text-ink">邀请成员</h2>
          <div className="mt-4 flex gap-2">
            <input
              value={inviteIdentifier}
              onChange={(e) => setInviteIdentifier(e.target.value)}
              placeholder="邮箱或手机号"
              className="w-64 rounded border border-line px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="rounded border border-line px-2 py-1.5 text-sm"
            >
              <option value="analyst">分析师</option>
              <option value="partner">合伙人</option>
              <option value="admin">管理员</option>
            </select>
            <button
              onClick={sendInvite}
              disabled={busy || !inviteIdentifier.trim()}
              className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              发出邀请
            </button>
          </div>

          {invitations.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-faint">
                    <th className="px-4 py-2 font-normal">身份</th>
                    <th className="px-4 py-2 font-normal">角色</th>
                    <th className="px-4 py-2 font-normal">状态</th>
                    <th className="px-4 py-2 font-normal">有效期至</th>
                    <th className="px-4 py-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id} className="border-b border-line/60">
                      <td className="px-4 py-2 text-ink">{i.identifier}</td>
                      <td className="px-4 py-2 text-ink-soft">
                        {ROLE_LABEL[i.role] ?? i.role}
                      </td>
                      <td className="px-4 py-2 text-ink-soft">
                        {STATUS_LABEL[i.status] ?? i.status}
                      </td>
                      <td className="px-4 py-2 text-ink-faint">
                        {fmtDate(i.expires_at)}
                      </td>
                      <td className="px-4 py-2">
                        {i.status === "pending" && (
                          <button
                            onClick={() => revokeInvite(i.id)}
                            disabled={busy}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            撤销
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 能力位 / 套餐状态（仅 admin，只读）。导航整合后默认由工作台「概览」展示。 */}
      {showCapabilities && isAdmin && (
        <section className="mt-12 border-t border-line pt-8">
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
      )}
    </div>
  );
}
