import { requireOrg } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { OrgSettingsClient } from "@/components/org/OrgSettingsClient";

export const dynamic = "force-dynamic";

// 组织设置：任意成员可见组织信息与成员列表；
// org admin 额外可见成员管理 / 邀请管理 / 组织信息编辑 / 能力位状态。
// middleware 已对无 token.orgId 的用户 302，此处 requireOrg 做 DB 现取双保险。
export default async function OrgSettingsPage() {
  const ctx = await requireOrg();

  const [orgRows, memberRows] = await Promise.all([
    query<{
      name: string;
      description: string | null;
      logo_url: string | null;
      created_at: string;
    }>(
      "SELECT name, description, logo_url, created_at FROM orgs WHERE id = $1",
      [ctx.orgId]
    ),
    query<{
      user_id: string;
      role: string;
      name: string;
      email: string | null;
      phone: string | null;
      joined_at: string;
    }>(
      `SELECT m.user_id, m.role, u.name, u.email, u.phone,
              m.created_at AS joined_at
         FROM org_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1
        ORDER BY m.created_at ASC`,
      [ctx.orgId]
    ),
  ]);

  const isAdmin = ctx.role === "admin";
  const invitationRows = isAdmin
    ? await query<{
        id: string;
        identifier: string;
        role: string;
        status: string;
        expires_at: string;
        created_at: string;
      }>(
        `SELECT id, identifier, role, status, expires_at, created_at
           FROM org_invitations
          WHERE org_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [ctx.orgId]
      )
    : [];

  const org = orgRows[0];

  return (
    <OrgSettingsClient
      org={{
        id: ctx.orgId,
        name: org?.name ?? ctx.orgName,
        description: org?.description ?? null,
        createdAt: org?.created_at ?? "",
      }}
      myUserId={ctx.userId}
      myRole={ctx.role}
      capabilities={ctx.capabilities}
      members={memberRows.map((m) => ({
        userId: m.user_id,
        role: m.role,
        name: m.name,
        email: m.email,
        phone: m.phone,
        joinedAt: m.joined_at,
      }))}
      invitations={invitationRows}
    />
  );
}
