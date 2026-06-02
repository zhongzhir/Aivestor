"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Row {
  userId: string;
  email: string | null;
  name: string;
  tokensUsed: number;
  tokensLimit: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function QuotaBatchPanel({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newLimit, setNewLimit] = useState("5000000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.userId)),
    [rows, selected]
  );

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.userId)));
  }

  async function applyBatch() {
    const n = Number(newLimit);
    if (!Number.isFinite(n) || n < 0) {
      setErr("请输入非负整数");
      return;
    }
    if (selected.size === 0) {
      setErr("请至少选中一个用户");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selected),
          tokensLimit: n,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `调整失败 ${res.status}`);
      }
      const data = (await res.json()) as { updated: number };
      setMsg(`已更新 ${data.updated} 个用户`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* 批量操作工具栏 */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <span className="text-gray-700">
          已选 <strong>{selected.size}</strong> / {rows.length} 人
        </span>
        <div className="ml-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">设置 tokens_limit 为：</span>
          <input
            type="number"
            min={0}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            className="w-32 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-gray-500 focus:outline-none"
          />
          <button
            onClick={applyBatch}
            disabled={busy || selected.size === 0}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "应用中…" : "批量应用"}
          </button>
        </div>
        {err && <span className="text-xs text-red-600">{err}</span>}
        {msg && <span className="text-xs text-green-600">{msg}</span>}
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 font-medium">用户</th>
              <th className="px-3 py-2 text-right font-medium">已用</th>
              <th className="px-3 py-2 text-right font-medium">上限</th>
              <th className="px-3 py-2 text-right font-medium">用量比</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                  暂无额度记录
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const pct =
                  r.tokensLimit > 0
                    ? Math.round((r.tokensUsed / r.tokensLimit) * 100)
                    : 0;
                return (
                  <tr key={r.userId} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.userId)}
                        onChange={() => toggle(r.userId)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-gray-900 hover:underline"
                      >
                        {r.email ?? r.name}
                      </Link>
                      <div className="text-[11px] text-gray-400">{r.name}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(r.tokensUsed)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(r.tokensLimit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {pct}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
