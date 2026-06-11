"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 平台 admin：创建 org 并指定首个 org admin（按邮箱/手机号查找已注册用户）。
export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [adminIdentifier, setAdminIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminIdentifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "创建失败");
        return;
      }
      setMsg(`已创建，首个管理员：${data.adminName}`);
      setName("");
      setAdminIdentifier("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-sm font-medium text-gray-900">创建组织</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="组织名称"
          className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <input
          value={adminIdentifier}
          onChange={(e) => setAdminIdentifier(e.target.value)}
          placeholder="首个管理员的邮箱 / 手机号"
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !name.trim() || !adminIdentifier.trim()}
          className="rounded bg-gray-900 px-4 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          创建
        </button>
      </div>
      {msg && <div className="mt-2 text-xs text-gray-600">{msg}</div>}
    </div>
  );
}
