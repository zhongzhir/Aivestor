"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// 待处理组织邀请卡片：挂在个人设置页顶部，无邀请时不渲染任何内容。
// 接受后刷新页面；token 中的 orgId 会在下次 jwt callback 时自动写入。

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  partner: "合伙人",
  analyst: "分析师",
};

interface Invite {
  id: string;
  role: string;
  org_name: string;
  invited_by_name: string | null;
  expires_at: string;
}

export function PendingInvites() {
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/org/invitations/mine")
      .then((r) => (r.ok ? r.json() : { invitations: [] }))
      .then((d) => setInvites(d.invitations ?? []))
      .catch(() => {});
  }, []);

  async function accept(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/org/invitations/${id}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "接受邀请失败");
        return;
      }
      setInvites((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const visible = invites.filter((i) => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-8 space-y-2">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {visible.map((i) => (
        <div
          key={i.id}
          className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3"
        >
          <div className="text-sm text-ink">
            <span className="font-medium">{i.org_name}</span> 邀请你以「
            {ROLE_LABEL[i.role] ?? i.role}」身份加入组织
            {i.invited_by_name && (
              <span className="text-ink-faint">
                （邀请人：{i.invited_by_name}）
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => accept(i.id)}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
            >
              接受
            </button>
            <button
              onClick={() =>
                setDismissed((prev) => new Set(prev).add(i.id))
              }
              className="rounded border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-white"
            >
              忽略
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
