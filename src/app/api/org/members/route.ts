// GET /api/org/members — 成员列表（任意成员可见）

import { NextResponse } from "next/server";
import { requireOrgAPI } from "@/lib/orgAuth";
import { query } from "@/lib/db";

export async function GET() {
  const guard = await requireOrgAPI();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const rows = await query<{
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
  );

  return NextResponse.json({
    members: rows.map((r) => ({
      userId: r.user_id,
      role: r.role,
      name: r.name,
      email: r.email,
      phone: r.phone,
      joinedAt: r.joined_at,
    })),
  });
}
