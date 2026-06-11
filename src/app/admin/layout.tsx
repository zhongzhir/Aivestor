import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

// 后续新增菜单项在这里加一行即可
const NAV: { href: string; label: string }[] = [
  { href: "/admin/dashboard", label: "数据概览" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/orgs", label: "组织管理" },
  { href: "/admin/quota", label: "额度管理" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 服务端 DB 校验（不依赖 token 缓存）
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 左侧导航 */}
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="text-sm font-semibold text-gray-900">
            Aivestor Admin
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">管理后台</div>
        </div>

        <nav className="flex-1 px-3 py-4 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded px-3 py-2 text-gray-700 hover:bg-gray-100"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          <div className="truncate">{admin.email ?? "(无邮箱)"}</div>
          <Link
            href="/dashboard"
            className="mt-1 inline-block text-gray-400 hover:text-gray-600"
          >
            ← 返回应用
          </Link>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
