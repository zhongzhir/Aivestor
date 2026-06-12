"use client";

import { useEffect, useState } from "react";

interface Member {
  userId: string;
  name: string | null;
}

interface Share {
  shared_with: string;
  user_name: string | null;
}

// 轻量项目共享入口（组织项目）：成员下拉多选共享 / 取消共享。
// owner 或 partner+ 操作；后端 /api/projects/[id]/shares 做权限校验，
// 无权时操作返回 403，组件提示。
export function ShareControl({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  async function loadShares() {
    const res = await fetch(`/api/projects/${projectId}/shares`);
    if (res.ok) setShares((await res.json()).shares ?? []);
  }

  useEffect(() => {
    fetch("/api/org/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.members ?? []).map(
          (m: { userId?: string; user_id?: string; name?: string }) => ({
            userId: m.userId ?? m.user_id,
            name: m.name ?? null,
          })
        );
        setMembers(list);
      })
      .catch(() => {});
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function add() {
    if (!selected) return;
    setError("");
    const res = await fetch(`/api/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sharedWith: selected }),
    });
    if (res.ok) {
      setSelected("");
      await loadShares();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? "操作失败");
    }
  }

  async function remove(userId: string) {
    const res = await fetch(`/api/projects/${projectId}/shares`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sharedWith: userId }),
    });
    if (res.ok) await loadShares();
  }

  const sharedIds = new Set(shares.map((s) => s.shared_with));
  const candidates = members.filter((m) => !sharedIds.has(m.userId));

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink">共享给成员</p>
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs text-ink"
        >
          <option value="">选择成员…</option>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name ?? m.userId}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={!selected}
          className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          共享
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {shares.length > 0 && (
        <ul className="space-y-1">
          {shares.map((s) => (
            <li
              key={s.shared_with}
              className="flex items-center justify-between text-xs text-ink-soft"
            >
              <span>{s.user_name ?? s.shared_with}</span>
              <button
                onClick={() => remove(s.shared_with)}
                className="text-ink-faint hover:underline"
              >
                取消
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
