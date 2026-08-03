import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { projectScope, scopeColumns, validateProjectLabel } from "@/lib/projectManagement";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";

async function getScope(req: Request) {
  const session = await getSession();
  if (!session?.user) return { response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const scope = await buildAccessScope(session.user.id);
  const projectId = new URL(req.url).searchParams.get("projectId");
  let effectiveScope = scope;
  if (projectId) {
    try {
      effectiveScope = projectScope(scope, await assertProjectAccess(scope, projectId, "write"));
    } catch (error) {
      return { response: accessErrorResponse(error) };
    }
  }
  return { scope: effectiveScope, scoped: scopeColumns(effectiveScope) };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const result = await getScope(req);
  if (result.response) return result.response;
  const { scoped } = result;
  if (result.scope.org && !["admin", "partner"].includes(result.scope.org.role)) {
    return NextResponse.json({ error: "仅机构管理员或合伙人可维护机构分类" }, { status: 403 });
  }
  let body: { name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const label = validateProjectLabel(body.name, "分类");
  if ("error" in label) return NextResponse.json({ error: label.error }, { status: 422 });
  try {
    const rows = await query<{ id: string; name: string }>(
      `UPDATE project_categories SET name = $1, normalized_name = $2, updated_at = NOW()
        WHERE id = $3 AND ${scoped.column} = $4 RETURNING id, name`,
      [label.value, label.normalized, params.id, scoped.value]
    );
    if (!rows[0]) return NextResponse.json({ error: "分类不存在" }, { status: 404 });
    return NextResponse.json({ category: rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "同名分类已存在" }, { status: 409 });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const result = await getScope(_req);
  if (result.response) return result.response;
  const { scoped } = result;
  if (result.scope.org && !["admin", "partner"].includes(result.scope.org.role)) {
    return NextResponse.json({ error: "仅机构管理员或合伙人可维护机构分类" }, { status: 403 });
  }
  const rows = await query<{ id: string }>(
    `DELETE FROM project_categories WHERE id = $1 AND ${scoped.column} = $2 RETURNING id`,
    [params.id, scoped.value]
  );
  if (!rows[0]) return NextResponse.json({ error: "分类不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
