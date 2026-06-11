import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import { CreateOrgForm } from "@/components/admin/CreateOrgForm";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  name: string;
  is_active: boolean;
  capabilities: unknown;
  member_count: string;
  created_at: string;
}

function parseCaps(raw: unknown): Record<string, boolean | number> {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof obj !== "object" || obj === null) return {};
  return obj as Record<string, boolean | number>;
}

// 能力位摘要：列出开启的 boolean 位 + max_members
function capsSummary(raw: unknown): string {
  const caps = parseCaps(raw);
  const on = Object.entries(caps)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const max = caps.max_members;
  const parts = [...on];
  if (typeof max === "number") parts.push(`max_members=${max}`);
  return parts.length > 0 ? parts.join(", ") : "（未配置）";
}

export default async function AdminOrgsPage() {
  await requireAdmin();

  let orgs: OrgRow[] = [];
  let migrationMissing = false;
  try {
    orgs = await query<OrgRow>(
      `SELECT o.id, o.name, o.is_active, o.capabilities, o.created_at,
              (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id)::text
                AS member_count
         FROM orgs o
        ORDER BY o.created_at DESC`
    );
  } catch {
    // 迁移 020 未执行：提示而非 500
    migrationMissing = true;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">组织管理</h1>
        <div className="text-xs text-gray-500">共 {orgs.length} 个组织</div>
      </div>

      {migrationMissing ? (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          orgs 表不存在：请先在数据库执行迁移
          <code className="mx-1">db/migrations/020_orgs_and_members.sql</code>
          后刷新本页。
        </div>
      ) : (
        <>
          <div className="mt-6">
            <CreateOrgForm />
          </div>

          <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-normal">名称</th>
                  <th className="px-4 py-2 font-normal">成员数</th>
                  <th className="px-4 py-2 font-normal">能力位</th>
                  <th className="px-4 py-2 font-normal">状态</th>
                  <th className="px-4 py-2 font-normal">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-b border-gray-100">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/orgs/${o.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {o.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {o.member_count}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-xs text-gray-500">
                      {capsSummary(o.capabilities)}
                    </td>
                    <td className="px-4 py-2">
                      {o.is_active ? (
                        <span className="text-green-700">启用</span>
                      ) : (
                        <span className="text-red-600">停用</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(o.created_at).toLocaleDateString("zh-CN")}
                    </td>
                  </tr>
                ))}
                {orgs.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-gray-400"
                    >
                      暂无组织，使用上方表单创建
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
