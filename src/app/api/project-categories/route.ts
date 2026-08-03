import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { projectScope, scopeColumns, validateProjectLabel } from "@/lib/projectManagement";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await buildAccessScope(session.user.id);
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  let effectiveScope = scope;
  if (projectId) {
    try {
      effectiveScope = projectScope(scope, await assertProjectAccess(scope, projectId, "write"));
    } catch (error) {
      return accessErrorResponse(error);
    }
  }
  if (effectiveScope.org && !["admin", "partner"].includes(effectiveScope.org.role)) {
    return NextResponse.json({ error: "仅机构管理员或合伙人可维护机构分类" }, { status: 403 });
  }
  let body: { name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const label = validateProjectLabel(body.name, "分类");
  if ("error" in label) return NextResponse.json({ error: label.error }, { status: 422 });
  const scoped = scopeColumns(effectiveScope);
  try {
    const rows = await query<{ id: string; name: string }>(
      `INSERT INTO project_categories (${scoped.column}, name, normalized_name)
       VALUES ($1, $2, $3) RETURNING id, name`,
      [scoped.value, label.value, label.normalized]
    );
    return NextResponse.json({ category: rows[0] }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "同名分类已存在" }, { status: 409 });
    throw e;
  }
}
