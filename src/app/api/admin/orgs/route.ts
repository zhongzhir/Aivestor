// POST /api/admin/orgs — 创建 org + 指定首个 org admin（按 email/phone 查找用户）
// GET  /api/admin/orgs — org 列表
//
// 双重权限：middleware 已挡 /admin 页面，本路由还要 requireAdminAPI 现取 DB 再校验。

import { NextResponse } from "next/server";
import { requireAdminAPI } from "@/lib/adminAuth";
import { query, pool } from "@/lib/db";

export async function GET() {
  const guard = await requireAdminAPI();
  if (!guard.ok) return guard.response;

  const rows = await query<{
    id: string;
    name: string;
    is_active: boolean;
    capabilities: unknown;
    member_count: string;
    created_at: string;
  }>(
    `SELECT o.id, o.name, o.is_active, o.capabilities, o.created_at,
            (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id)::text
              AS member_count
       FROM orgs o
      ORDER BY o.created_at DESC`
  );
  return NextResponse.json({ orgs: rows });
}

const MAX_NAME_LEN = 100;

export async function POST(req: Request) {
  const guard = await requireAdminAPI();
  if (!guard.ok) return guard.response;

  let body: { name?: unknown; adminIdentifier?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `组织名称需为 1-${MAX_NAME_LEN} 字符` },
      { status: 400 }
    );
  }

  const identifier =
    typeof body.adminIdentifier === "string"
      ? body.adminIdentifier.trim().toLowerCase()
      : "";
  if (!identifier) {
    return NextResponse.json(
      { error: "请提供首个组织管理员的邮箱或手机号" },
      { status: 400 }
    );
  }

  // 按 email / phone 查找用户（email 已统一小写；phone 不受 lower 影响）
  const users = await query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE email = $1 OR phone = $1",
    [identifier]
  );
  const user = users[0];
  if (!user) {
    return NextResponse.json(
      { error: "未找到该用户，请确认其已注册" },
      { status: 404 }
    );
  }

  // 一人一 org：该用户已有组织则拒绝
  const existing = await query<{ org_id: string }>(
    "SELECT org_id FROM org_members WHERE user_id = $1",
    [user.id]
  );
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "该用户已属于其他组织（一人一组织）" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orgRes = await client.query<{ id: string }>(
      "INSERT INTO orgs (name) VALUES ($1) RETURNING id",
      [name]
    );
    const orgId = orgRes.rows[0].id;
    await client.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [orgId, user.id]
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, orgId, adminName: user.name });
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "该用户已属于其他组织（一人一组织）" },
        { status: 400 }
      );
    }
    throw e;
  } finally {
    client.release();
  }
}
