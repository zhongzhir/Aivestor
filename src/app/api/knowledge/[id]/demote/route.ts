import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";

// POST /api/knowledge/[id]/demote — 撤回机构层副本（架构文档 3.4 修订）
// 晋升是复制：撤回即删除机构层副本，个人层原记录（source_entry_id 指向）永不受影响。
// 撤回限副本作者或 org admin。
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

  // 删除机构层副本本身；个人层原记录从未变动，不受影响。
  await query(
    `DELETE FROM knowledge_base_entries
      WHERE id = $1 AND visibility = 'org' AND org_id = $2`,
    [params.id, entry.org_id]
  );
  return NextResponse.json({ success: true });
}
