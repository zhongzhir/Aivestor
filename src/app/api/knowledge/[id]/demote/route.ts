import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";

// POST /api/knowledge/[id]/demote — 从机构层撤回条目（架构文档 3.4）
// 撤回限作者或 org admin。撤回后回到个人私有层。
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const rows = await query<{ user_id: string; org_id: string | null; visibility: string }>(
    "SELECT user_id, org_id, visibility FROM knowledge_base_entries WHERE id = $1",
    [params.id]
  );
  const entry = rows[0];
  if (!entry || entry.visibility !== "org") {
    return NextResponse.json({ error: "条目不存在或不在机构层" }, { status: 404 });
  }

  // 作者本人，或同组织 admin。
  let allowed = entry.user_id === userId;
  if (!allowed) {
    const scope = await buildAccessScope(userId);
    allowed =
      !!scope.org &&
      scope.org.orgId === entry.org_id &&
      scope.org.role === "admin";
  }
  if (!allowed) {
    return NextResponse.json({ error: "无权撤回该条目" }, { status: 403 });
  }

  // 回到个人私有层（清除机构归属与晋升痕迹）。
  await query(
    `UPDATE knowledge_base_entries
        SET visibility = 'private', org_id = NULL,
            promoted_by = NULL, promoted_at = NULL
      WHERE id = $1`,
    [params.id]
  );
  return NextResponse.json({ success: true });
}
