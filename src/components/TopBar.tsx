"use client";

import Link from "next/link";

function HelpCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e5ded2] bg-[#fbfaf7] px-6">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-soft">
          投资工作台：项目、判断、材料和知识保持在同一条线上
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link
          href="/help"
          title="使用说明"
          aria-label="使用说明"
          className="text-ink-faint transition-colors hover:text-ink-soft"
        >
          <HelpCircleIcon className="h-5 w-5" />
        </Link>
        <Link
          href="/projects/new"
          className="rounded-lg bg-[#2f6f4f] px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#265b42]"
        >
          新建项目
        </Link>
      </div>
    </header>
  );
}
