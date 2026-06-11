// POST /api/org/invitations — 发出邀请（org admin，校验 max_members）
// GET  /api/org/invitations — 邀请列表（org admin）

import { NextResponse } from "next/server";
import { requireOrgAPI, getCapabilityNumber } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { isValidPhone } from "@/lib/authUtils";

const VALID_ROLES = ["admin", "partner", "analyst"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const rows = await query<{
    id: string;
    identifier: string;
    role: string;
    status: string;
    expires_at: string;
    created_at: string;
    invited_by_name: string | null;
  }>(
    `SELECT i.id, i.identifier, i.role, i.status, i.expires_at, i.created_at,
            u.name AS invited_by_name
       FROM org_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.org_id = $1
      ORDER BY i.created_at DESC
      LIMIT 100`,
    [ctx.orgId]
  );

  return NextResponse.json({ invitations: rows });
}

export async function POST(req: Request) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  let body: { identifier?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const rawIdentifier =
    typeof body.identifier === "string" ? body.identifier.trim() : "";
  // 邮箱统一小写（与 auth.ts 登录归一化一致），手机号原样
  const identifier = EMAIL_RE.test(rawIdentifier)
    ? rawIdentifier.toLowerCase()
    : rawIdentifier;
  if (!EMAIL_RE.test(identifier) && !isValidPhone(identifier)) {
    return NextResponse.json(
      { error: "请输入有效的邮箱或手机号" },
      { status: 400 }
    );
  }

  const role =
    typeof body.role === "string" && VALID_ROLES.includes(body.role as never)
      ? body.role
      : "analyst";

  // max_members 校验：现有成员数 + 待处理邀请数 < 上限
  const maxMembers = await getCapabilityNumber(ctx.orgId, "max_members");
  if (maxMembers > 0) {
    const counts = await query<{ members: string; pending: string }>(
      `SELECT
         (SELECT COUNT(*) FROM org_members WHERE org_id = $1)::text AS members,
         (SELECT COUNT(*) FROM org_invitations
           WHERE org_id = $1 AND status = 'pending'
             AND expires_at > now())::text AS pending`,
      [ctx.orgId]
    );
    const occupied =
      Number(counts[0]?.members ?? 0) + Number(counts[0]?.pending ?? 0);
    if (occupied >= maxMembers) {
      return NextResponse.json(
        { error: `成员数已达套餐上限（${maxMembers} 人，含待处理邀请）` },
        { status: 400 }
      );
    }
  }

  // 该身份若已是本组织成员，直接拒绝
  const existing = await query<{ id: string }>(
    `SELECT m.id FROM org_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND (u.email = $2 OR u.phone = $2)`,
    [ctx.orgId, identifier]
  );
  if (existing.length > 0) {
    return NextResponse.json({ error: "该用户已是组织成员" }, { status: 400 });
  }

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO org_invitations (org_id, identifier, role, invited_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [ctx.orgId, identifier, role, ctx.userId]
    );
    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (e) {
    // 部分唯一索引 idx_org_invitations_pending 冲突：已有待处理邀请
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "该身份已有待处理邀请，请先撤销后再重新邀请" },
        { status: 400 }
      );
    }
    throw e;
  }
}
