"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { BRAND } from "@/lib/brand";

const NAV = [
  { href: "/dashboard", label: "工作台", desc: "今日关注" },
  { href: "/chat", label: "研究对话", desc: "讨论与沉淀" },
  { href: "/projects", label: "项目管线", desc: "分析与推进" },
  { href: "/archive", label: "项目档案", desc: "历史与投后" },
  { href: "/knowledge", label: "知识库", desc: "经验复用" },
  { href: "/skills", label: "SKILL 广场", desc: "分析框架" },
  { href: "/settings", label: "设置", desc: "偏好与账户" },
];

export function Sidebar({
  hasOrganization = false,
}: {
  hasOrganization?: boolean;
  /** @deprecated Kept for archived checkout compatibility; organization state is authoritative. */
  dataAppsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const nav = session?.user
    ? [
        ...NAV,
        ...(hasOrganization
          ? [
              {
                href: "/org/workspace",
                label: "组织工作台",
                desc: "团队与报告",
              },
              {
                href: "/data-apps",
                label: "数据应用",
                desc: "情报订制与机构数据",
              },
            ]
          : [
              {
                href: "/data-apps/intelligence-subscriptions",
                label: "情报订制",
                desc: "按关注持续整理",
              },
            ]),
      ]
    : NAV;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[#e5ded2] bg-[#f4f1ea]">
      <div className="px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src={BRAND.assets.logo} alt={BRAND.productName} width={220} height={64} className="h-10 w-auto max-w-[190px] object-contain object-left" priority />
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
                  ? "bg-white text-ink shadow-[0_1px_2px_rgba(55,53,47,0.06)]"
                  : "text-ink-soft hover:bg-white/60 hover:text-ink"
              }`}
            >
              <span className="text-sm font-medium">{item.label}</span>
              <span
                className={`text-xs ${
                  active ? "text-accent" : "text-ink-faint"
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
            className="block rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90"
          >
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
