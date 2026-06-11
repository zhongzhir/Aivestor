import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import { OrgCapabilitiesEditor } from "@/components/admin/OrgCapabilitiesEditor";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  partner: "合伙人",
  analyst: "分析师",
};

export default async function AdminOrgDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();
  if (!UUID_RE.test(params.id)) notFound();

  const orgs = await query<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    capabilities: unknown;
    created_at: string;
  }>(
    `SELECT id, name, description, is_active, capabilities, created_at
       FROM orgs WHERE id = $1`,
    [params.id]
  );
  const org = orgs[0];
  if (!org) notFound();

  const members = await query<{
    user_id: string;
    role: string;
    name: string;
    email: string | null;
    phone: string | null;
    created_at: string;
  }>(
    `SELECT m.user_id, m.role, u.name, u.email, u.phone, m.created_at
       FROM org_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1
      ORDER BY m.created_at ASC`,
    [params.id]
  );

  return (
    <div className="p-8">
      <Link
        href="/admin/orgs"
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        ← 返回组织列表
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-gray-900">{org.name}</h1>
      <p className="mt-1 text-xs text-gray-500">
        创建于 {new Date(org.created_at).toLocaleDateString("zh-CN")}
        {org.description ? ` · ${org.description}` : ""}
      </p>

      {/* capabilities 编辑 + 预设包 + 停用/启用 */}
      <section className="mt-6">
        <OrgCapabilitiesEditor
          orgId={org.id}
          initialCapabilities={parseCaps(org.capabilities)}
          initialIsActive={org.is_active}
        />
      </section>

      {/* 成员列表（只读） */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          成员（{members.length} 人，只读）
        </h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-normal">姓名</th>
                <th className="px-4 py-2 font-normal">邮箱 / 手机</th>
                <th className="px-4 py-2 font-normal">角色</th>
                <th className="px-4 py-2 font-normal">加入时间</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b border-gray-100">
                  <td className="px-4 py-2 text-gray-900">{m.name}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {m.email ?? m.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(m.created_at).toLocaleDateString("zh-CN")}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-gray-400"
                  >
                    暂无成员
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
