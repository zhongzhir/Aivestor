"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

// 主导航。对应 PRD 五大核心模块，MVP 阶段聚焦知识库 / 项目 / 归档。
const NAV = [
  { href: "/dashboard", label: "首页", desc: "概览" },
  { href: "/chat", label: "对话", desc: "与 AI 自由探讨" },
  { href: "/projects", label: "项目分析", desc: "上传 BP，生成分析报告" },
  { href: "/archive", label: "项目档案", desc: "项目全生命周期记录" },
  { href: "/knowledge", label: "知识库", desc: "私有知识沉淀与检索" },
  { href: "/skills", label: "SKILL 广场", desc: "投资分析技能库" },
  { href: "/settings", label: "个人设置", desc: "个人画像与 AI 配置" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 512 512"
            className="h-8 w-8 shrink-0"
            aria-hidden="true"
          >
            <rect width="512" height="512" rx="114" fill="#0D1B3E" />
            <g transform="translate(256, 280)">
              <line x1="-130" y1="-154" x2="-24" y2="58" stroke="#4A9EFF" strokeWidth="28" strokeLinecap="round" />
              <line x1="130" y1="-154" x2="24" y2="58" stroke="#4A9EFF" strokeWidth="28" strokeLinecap="round" />
              <line x1="-84" y1="-154" x2="-15" y2="12" stroke="#FF6B35" strokeWidth="13" strokeLinecap="round" />
              <line x1="84" y1="-154" x2="15" y2="12" stroke="#FF6B35" strokeWidth="13" strokeLinecap="round" />
              <circle cx="-130" cy="-154" r="22" fill="#4A9EFF" />
              <circle cx="130" cy="-154" r="22" fill="#4A9EFF" />
              <circle cx="-84" cy="-154" r="14" fill="#FF6B35" opacity="0.8" />
              <circle cx="84" cy="-154" r="14" fill="#FF6B35" opacity="0.8" />
            </g>
          </svg>
          <span
            className="text-base text-[#0D1B3E]"
            style={{ letterSpacing: "3px" }}
          >
            <span style={{ fontWeight: 300 }}>Ai</span>
            <span style={{ fontWeight: 700 }}>vestor</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-2">
        {NAV.map((item) => {
          // /dashboard 在根路径下也高亮（因为 / 会重定向到 /dashboard）
          const active =
            item.href === "/dashboard"
              ? pathname === "/" || pathname.startsWith("/dashboard")
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors duration-150 ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-ink-soft hover:bg-slate-100 hover:text-ink"
              }`}
            >
              <div
                className={`text-sm ${active ? "font-medium" : "font-medium"}`}
              >
                {item.label}
              </div>
              <div
                className={`text-xs ${
                  active ? "text-blue-700/70" : "text-ink-faint"
                }`}
              >
                {item.desc}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-3">
        {status === "loading" ? (
          <div className="px-1 py-2 text-xs text-ink-faint">加载中…</div>
        ) : session?.user ? (
          <div>
            <div className="px-1 text-sm font-medium text-ink">
              {session.user.name}
            </div>
            <div className="truncate px-1 text-xs text-ink-faint">
              {session.user.email}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mt-2 w-full rounded-md px-1 py-1.5 text-left text-xs text-ink-soft hover:bg-line/60 hover:text-ink"
            >
              退出登录
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="block rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90"
          >
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
