import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
} from "@/lib/resourceAccess";

// DELETE /api/projects/[id] — 软删除项目，保留全部关联数据供运维恢复。
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "delete");
  } catch (e) {
    return accessErrorResponse(e);
  }

  const rows = await query<{ id: string }>(
    `UPDATE projects
        SET deleted_at = NOW(), deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [params.id, session.user.id]
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
