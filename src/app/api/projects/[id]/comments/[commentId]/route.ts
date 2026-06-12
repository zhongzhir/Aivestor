import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";

// DELETE /api/projects/[id]/comments/[commentId] — 删自己的；org admin 可删任意
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; commentId: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const rows = await query<{ user_id: string; org_id: string }>(
    "SELECT user_id, org_id FROM project_comments WHERE id = $1 AND project_id = $2",
    [params.commentId, params.id]
  );
  const comment = rows[0];
  if (!comment) {
    return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  }

  let allowed = comment.user_id === userId;
  if (!allowed) {
    const scope = await buildAccessScope(userId);
    allowed =
      !!scope.org &&
      scope.org.orgId === comment.org_id &&
      scope.org.role === "admin";
  }
  if (!allowed) {
    return NextResponse.json({ error: "无权删除该评论" }, { status: 403 });
  }

  await query("DELETE FROM project_comments WHERE id = $1", [params.commentId]);
  return NextResponse.json({ success: true });
}
