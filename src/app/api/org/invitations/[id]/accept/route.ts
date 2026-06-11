// POST /api/org/invitations/[id]/accept — 接受邀请，成为组织成员
//
// 校验链：邀请存在且 pending 未过期 → identifier 与当前用户 email/phone
// 匹配 → 用户当前无组织（一人一 org）→ 目标 org 成员数未超 max_members
// → 事务内写 org_members + 置邀请 accepted。
// 唯一索引 idx_org_members_single_org 兜底并发下的一人一 org。

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOrgContext, getCapabilityNumber } from "@/lib/orgAuth";
import { query, pool } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "邀请不存在" }, { status: 404 });
  }

  // 应用层先查给出友好错误（唯一索引兜底）
  const currentOrg = await getOrgContext(userId);
  if (currentOrg) {
    return NextResponse.json(
      { error: "您已属于一个组织，暂不支持同时加入多个组织" },
      { status: 400 }
    );
  }

  const invitations = await query<{
    org_id: string;
    identifier: string;
    role: string;
    invited_by: string;
  }>(
    `SELECT i.org_id, i.identifier, i.role, i.invited_by
       FROM org_invitations i
       JOIN orgs o ON o.id = i.org_id AND o.is_active = true
      WHERE i.id = $1 AND i.status = 'pending' AND i.expires_at > now()`,
    [params.id]
  );
  const inv = invitations[0];
  if (!inv) {
    return NextResponse.json(
      { error: "邀请不存在、已失效或已被撤销" },
      { status: 404 }
    );
  }

  // identifier 必须与当前用户的邮箱或手机号匹配
  const me = await query<{ email: string | null; phone: string | null }>(
    "SELECT email, phone FROM users WHERE id = $1",
    [userId]
  );
  const email = me[0]?.email?.toLowerCase() ?? null;
  const phone = me[0]?.phone ?? null;
  if (inv.identifier !== email && inv.identifier !== phone) {
    return NextResponse.json(
      { error: "该邀请不属于当前登录账号" },
      { status: 403 }
    );
  }

  // max_members 校验
  const maxMembers = await getCapabilityNumber(inv.org_id, "max_members");
  if (maxMembers > 0) {
    const counts = await query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM org_members WHERE org_id = $1",
      [inv.org_id]
    );
    if (Number(counts[0]?.c ?? 0) >= maxMembers) {
      return NextResponse.json(
        { error: "该组织成员数已达上限，请联系组织管理员" },
        { status: 400 }
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO org_members (org_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)`,
      [inv.org_id, userId, inv.role, inv.invited_by]
    );
    await client.query(
      "UPDATE org_invitations SET status = 'accepted' WHERE id = $1",
      [params.id]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") {
      // idx_org_members_single_org / UNIQUE(org_id,user_id) 并发兜底
      return NextResponse.json(
        { error: "您已属于一个组织，暂不支持同时加入多个组织" },
        { status: 400 }
      );
    }
    throw e;
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, orgId: inv.org_id, role: inv.role });
}
