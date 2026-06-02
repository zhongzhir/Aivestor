"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function QuotaAdjuster({
  userId,
  currentLimit,
}: {
  userId: string;
  currentLimit: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(currentLimit));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setErr("请输入非负整数");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId], tokensLimit: n }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `调整失败 ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="block text-xs text-gray-500">新的上限</label>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-40 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-gray-500 focus:outline-none"
        />
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? "保存中…" : "保存"}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
