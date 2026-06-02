import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

interface Row {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  plan: string;
  created_at: string;
  tokens_used: string | null;
  tokens_limit: string | null;
}

interface SearchParams {
  q?: string;
  page?: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();

  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // 同时拿总数 + 当页数据
  const where = q
    ? `WHERE u.email ILIKE $1 OR u.name ILIKE $1 OR u.phone ILIKE $1`
    : "";
  const params: unknown[] = q ? [`%${q}%`] : [];

  const countRes = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users u ${where}`,
    params
  );
  const total = Number(countRes[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = await query<Row>(
    `SELECT u.id, u.email, u.name, u.phone, u.plan, u.created_at,
            q.tokens_used::text AS tokens_used,
            q.tokens_limit::text AS tokens_limit
       FROM users u
  LEFT JOIN free_quota_usage q ON q.user_id = u.id
       ${where}
   ORDER BY u.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">用户管理</h1>
        <div className="text-xs text-gray-500">共 {fmt(total)} 人</div>
      </div>

      {/* 搜索 */}
      <form method="get" className="mt-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="搜索邮箱 / 姓名 / 手机号"
          className="w-72 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
        >
          搜索
        </button>
        {q && (
          <Link
            href="/admin/users"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            清空
          </Link>
        )}
      </form>

      {/* 表格 */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">注册时间</th>
              <th className="px-3 py-2 font-medium">邮箱</th>
              <th className="px-3 py-2 font-medium">姓名</th>
              <th className="px-3 py-2 font-medium">手机号</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 text-right font-medium">已用 / 上限</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  无匹配用户
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-3 py-2 text-gray-500">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      {new Date(r.created_at).toISOString().slice(0, 10)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      {r.email ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      {r.phone ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      <span
                        className={
                          r.plan === "admin"
                            ? "rounded bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-700"
                            : "text-gray-500"
                        }
                      >
                        {r.plan}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    <Link href={`/admin/users/${r.id}`} className="block">
                      {fmt(r.tokens_used == null ? null : Number(r.tokens_used))} /{" "}
                      {fmt(r.tokens_limit == null ? null : Number(r.tokens_limit))}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <div>
          第 {page} / {totalPages} 页
        </div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/admin/users?${new URLSearchParams({
                ...(q ? { q } : {}),
                page: String(page - 1),
              }).toString()}`}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            >
              上一页
            </Link>
          )}
          {page < totalPages && (
            <Link
              href={`/admin/users?${new URLSearchParams({
                ...(q ? { q } : {}),
                page: String(page + 1),
              }).toString()}`}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            >
              下一页
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
