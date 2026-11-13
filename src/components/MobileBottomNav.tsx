"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MOBILE_PRIMARY_NAV,
  isPrimaryNavigationActive,
} from "@/lib/primaryNavigation";

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="移动端主导航"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#fbfaf7]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(55,53,47,0.08)] backdrop-blur md:hidden"
    >
      <div className="grid h-16 grid-cols-4">
        {MOBILE_PRIMARY_NAV.map((item) => {
          const active = isPrimaryNavigationActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-center transition-colors ${
                active ? "text-accent" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-0.5 w-8 rounded-full ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
              />
              <span className="text-xs font-semibold">{item.label}</span>
              <span className="text-[10px]">{item.desc}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
