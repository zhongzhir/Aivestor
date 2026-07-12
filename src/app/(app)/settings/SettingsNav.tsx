"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_NAV = [
  {
    href: "/settings/preference",
    title: "投资偏好",
    desc: "画像与判断口径",
  },
  {
    href: "/settings/account",
    title: "账户与安全",
    desc: "登录与手机号",
  },
  {
    href: "/settings/ai",
    title: "AI 与模型",
    desc: "服务商与 API Key",
  },
  {
    href: "/settings/data",
    title: "数据与协议",
    desc: "导出与条款",
  },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-2 lg:sticky lg:top-6 lg:self-start">
      {SETTINGS_NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded-lg border px-4 py-3 text-sm transition-colors ${
              active
                ? "border-accent bg-[#fffdfa] text-accent"
                : "border-line bg-white text-ink-soft hover:border-accent hover:bg-[#fffdfa]"
            }`}
          >
            <span className="font-medium text-ink">{item.title}</span>
            <span className="mt-1 block text-xs text-ink-faint">
              {item.desc}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
