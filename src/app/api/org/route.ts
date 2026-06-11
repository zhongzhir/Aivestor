// GET   /api/org — 当前用户的组织信息（含角色、能力位摘要）
// PATCH /api/org — 改组织名/简介/logo（org admin）
//
// 双重权限：middleware 不覆盖 /api，本路由经 requireOrgAPI 从 DB 现取校验。

import { NextResponse } from "next/server";
import { requireOrgAPI } from "@/lib/orgAuth";
import { query } from "@/lib/db";

export async function GET() {
  const guard = await requireOrgAPI();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const rows = await query<{
    name: string;
    description: string | null;
    logo_url: string | null;
    created_at: string;
  }>(
    "SELECT name, description, logo_url, created_at FROM orgs WHERE id = $1",
    [ctx.orgId]
  );
  const org = rows[0];
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  return NextResponse.json({
    id: ctx.orgId,
    name: org.name,
    description: org.description,
    logoUrl: org.logo_url,
    createdAt: org.created_at,
    myRole: ctx.role,
    capabilities: ctx.capabilities,
  });
}

const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 2000;

export async function PATCH(req: Request) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  let body: { name?: unknown; description?: unknown; logoUrl?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `组织名称需为 1-${MAX_NAME_LEN} 字符` },
        { status: 400 }
      );
    }
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if (typeof body.description === "string") {
    params.push(body.description.trim().slice(0, MAX_DESC_LEN) || null);
    sets.push(`description = $${params.length}`);
  }
  if (typeof body.logoUrl === "string") {
    params.push(body.logoUrl.trim() || null);
    sets.push(`logo_url = $${params.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  params.push(ctx.orgId);
  await query(
    `UPDATE orgs SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
  );
  return NextResponse.json({ ok: true });
}
