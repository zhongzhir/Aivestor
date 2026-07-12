"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();
  const crumbs = getCrumbs(pathname);
  const current = crumbs[crumbs.length - 1];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e5ded2] bg-[#fbfaf7] px-6">
      <div className="min-w-0">
        <nav className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
          {crumbs.slice(0, -1).map((crumb) => (
            <span key={crumb.href ?? crumb.label} className="flex min-w-0 items-center gap-2">
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="shrink-0 transition-colors hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="shrink-0">{crumb.label}</span>
              )}
              <span className="text-ink-faint">/</span>
            </span>
          ))}
          <span className="truncate font-medium text-ink">
            {current?.label ?? "投资工作台"}
          </span>
        </nav>
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

interface Crumb {
  label: string;
  href?: string;
}

function getCrumbs(pathname: string): Crumb[] {
  if (pathname === "/dashboard") return [{ label: "工作台" }];
  if (pathname === "/projects") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "项目管线" },
    ];
  }
  if (pathname === "/projects/new") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "项目管线", href: "/projects" },
      { label: "新建项目" },
    ];
  }
  if (pathname.startsWith("/projects/")) {
    const parts = pathname.split("/").filter(Boolean);
    const projectHref = parts[1] ? `/projects/${parts[1]}` : "/projects";
    const leaf = parts[2];
    const labels: Record<string, string> = {
      report: "分析报告",
      "brief-analysis": "简要分析",
      "term-sheet": "Term Sheet",
    };
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "项目管线", href: "/projects" },
      ...(leaf
        ? [
            { label: "项目工作区", href: projectHref },
            { label: labels[leaf] ?? "项目功能" },
          ]
        : [{ label: "项目工作区" }]),
    ];
  }
  if (pathname === "/archive" || pathname.startsWith("/archive/")) {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "项目档案" },
    ];
  }
  if (pathname === "/knowledge") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "知识库" },
    ];
  }
  if (pathname === "/skills") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "SKILL 广场" },
    ];
  }
  if (pathname === "/chat") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "研究对话" },
    ];
  }
  if (pathname.startsWith("/org/")) {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "组织工作台" },
    ];
  }
  if (pathname.startsWith("/data-apps")) {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "数据应用" },
    ];
  }
  if (pathname.startsWith("/settings")) {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "设置" },
    ];
  }
  if (pathname === "/cognition") {
    return [
      { label: "工作台", href: "/dashboard" },
      { label: "认知分析" },
    ];
  }
  return [{ label: "投资工作台" }];
}
