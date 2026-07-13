import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope, scopedProjectChildWhere } from "@/lib/resourceAccess";

export async function DELETE(_req: Request, { params }: { params: { id: string; relationshipId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const scope = await buildAccessScope(session.user.id);
    await assertProjectAccess(scope, params.id, "write");
    const child = scopedProjectChildWhere(scope, 3, { alias: "r" });
    await query(
      `DELETE FROM project_relationships r
        WHERE r.id = $1 AND r.project_id = $2 AND ${child.sql}`,
      [params.relationshipId, params.id, ...child.params]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    try { return accessErrorResponse(e); } catch { return NextResponse.json({ error: "删除关系记录失败" }, { status: 500 }); }
  }
}
