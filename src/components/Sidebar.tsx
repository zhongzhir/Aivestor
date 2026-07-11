"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const NAV = [
  { href: "/dashboard", label: "工作台", desc: "今日关注" },
  { href: "/chat", label: "研究对话", desc: "讨论与沉淀" },
  { href: "/projects", label: "项目管线", desc: "分析与推进" },
  { href: "/archive", label: "项目档案", desc: "历史与投后" },
  { href: "/knowledge", label: "知识库", desc: "经验复用" },
  { href: "/skills", label: "SKILL 广场", desc: "分析框架" },
  { href: "/settings", label: "个人设置", desc: "画像与模型" },
];

export function Sidebar({
  dataAppsEnabled = false,
}: {
  dataAppsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const nav = session?.user?.orgId
    ? [
        ...NAV,
        {
          href: "/org/workspace",
          label: "组织工作台",
          desc: "团队与报告",
        },
        ...(dataAppsEnabled
          ? [
              {
                href: "/data-apps",
                label: "数据应用",
                desc: "市场与机构",
              },
            ]
          : []),
      ]
    : NAV;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[#e5ded2] bg-[#f4f1ea]">
      <div className="px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 512 512"
            className="h-8 w-8 shrink-0"
            aria-hidden="true"
          >
            <rect width="512" height="512" rx="114" fill="#15372A" />
            <g transform="translate(256, 280)">
              <line
                x1="-130"
                y1="-154"
                x2="-24"
                y2="58"
                stroke="#7CB7A0"
                strokeWidth="28"
                strokeLinecap="round"
              />
              <line
                x1="130"
                y1="-154"
                x2="24"
                y2="58"
                stroke="#7CB7A0"
                strokeWidth="28"
                strokeLinecap="round"
              />
              <line
                x1="-84"
                y1="-154"
                x2="-15"
                y2="12"
                stroke="#D59A5A"
                strokeWidth="13"
                strokeLinecap="round"
              />
              <line
                x1="84"
                y1="-154"
                x2="15"
                y2="12"
                stroke="#D59A5A"
                strokeWidth="13"
                strokeLinecap="round"
              />
              <circle cx="-130" cy="-154" r="22" fill="#7CB7A0" />
              <circle cx="130" cy="-154" r="22" fill="#7CB7A0" />
              <circle cx="-84" cy="-154" r="14" fill="#D59A5A" opacity="0.85" />
              <circle cx="84" cy="-154" r="14" fill="#D59A5A" opacity="0.85" />
            </g>
          </svg>
          <span className="text-base text-[#15372A]" style={{ letterSpacing: 3 }}>
            <span style={{ fontWeight: 300 }}>Ai</span>
            <span style={{ fontWeight: 700 }}>vestor</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-2">
        {nav.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/" || pathname.startsWith("/dashboard")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-1 flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors duration-150 ${
                active
                  ? "bg-white text-[#15372A] shadow-[0_1px_2px_rgba(55,53,47,0.06)]"
                  : "text-ink-soft hover:bg-white/60 hover:text-ink"
              }`}
            >
              <span className="text-sm font-medium">{item.label}</span>
              <span
                className={`text-xs ${
                  active ? "text-[#2f6f4f]" : "text-ink-faint"
                }`}
              >
                {item.desc}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#e5ded2] px-4 py-3">
        {status === "loading" ? (
          <div className="px-1 py-2 text-xs text-ink-faint">加载中</div>
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
              className="mt-2 w-full rounded-md px-1 py-1.5 text-left text-xs text-ink-soft hover:bg-white/70 hover:text-ink"
            >
              退出登录
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="block rounded-lg bg-[#2f6f4f] px-3 py-2 text-center text-sm font-medium text-white hover:bg-[#265b42]"
          >
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
