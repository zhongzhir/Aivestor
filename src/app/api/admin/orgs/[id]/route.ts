// PATCH /api/admin/orgs/[id] — 调整 capabilities / is_active（平台 admin）
//
// 修改 capabilities 后主动清除 orgAuth 内存缓存，使变更即时生效
//（不只依赖 30s TTL）。

import { NextResponse } from "next/server";
import { requireAdminAPI } from "@/lib/adminAuth";
import { invalidateOrgCapabilities } from "@/lib/orgAuth";
import { query } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdminAPI();
  if (!guard.ok) return guard.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  let body: { capabilities?: unknown; isActive?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const sets: string[] = [];
  const sqlParams: unknown[] = [];

  if (body.capabilities !== undefined) {
    if (
      typeof body.capabilities !== "object" ||
      body.capabilities === null ||
      Array.isArray(body.capabilities)
    ) {
      return NextResponse.json(
        { error: "capabilities 必须为对象" },
        { status: 400 }
      );
    }
    // 仅接受 boolean / number 值（与 orgAuth.parseCapabilities 口径一致）
    const caps: Record<string, boolean | number> = {};
    for (const [k, v] of Object.entries(
      body.capabilities as Record<string, unknown>
    )) {
      if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) {
        caps[k] = v;
      } else {
        return NextResponse.json(
          { error: `能力位 ${k} 的值必须为布尔或数字` },
          { status: 400 }
        );
      }
    }
    sqlParams.push(JSON.stringify(caps));
    sets.push(`capabilities = $${sqlParams.length}::jsonb`);
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "isActive 必须为布尔值" },
        { status: 400 }
      );
    }
    sqlParams.push(body.isActive);
    sets.push(`is_active = $${sqlParams.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  sqlParams.push(params.id);
  const rows = await query<{ id: string }>(
    `UPDATE orgs SET ${sets.join(", ")} WHERE id = $${sqlParams.length} RETURNING id`,
    sqlParams
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  // 主动清缓存：能力位 / 停用状态变更即时生效
  invalidateOrgCapabilities(params.id);

  return NextResponse.json({ ok: true });
}
