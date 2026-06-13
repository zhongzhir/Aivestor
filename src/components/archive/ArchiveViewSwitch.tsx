"use client";

import Link from "next/link";

// 项目档案 / 机构档案 视图切换（仅机构管理层 + 开通统计能力时显示）。
// 样式与知识库「个人层 / 机构沉淀层」切换一致（圆角药丸分段控件）。
export function ArchiveViewSwitch({ view }: { view: "personal" | "org" }) {
  const items: { key: "personal" | "org"; label: string; href: string }[] = [
    { key: "personal", label: "项目档案", href: "/archive" },
    { key: "org", label: "机构档案", href: "/archive?view=org" },
  ];
  return (
    <div className="mt-4 flex gap-1 text-xs">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`rounded-full border px-3 py-1 transition-colors ${
            view === it.key
              ? "border-[#0D1B3E] bg-[#0D1B3E] text-white"
              : "border-line text-ink-soft hover:border-[#0D1B3E]"
          }`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}
