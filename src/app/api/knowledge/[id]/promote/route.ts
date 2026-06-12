import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

// POST /api/knowledge/[id]/promote — 把个人条目晋升到机构沉淀层（架构文档 3.4）
// 晋升是移动不是复制：同一条目改可见性。校验本人条目 + org_knowledge 能力位。
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const scope = await buildAccessScope(userId);
  if (!scope.org) {
    return NextResponse.json({ error: "您不属于任何组织" }, { status: 403 });
  }
  if (!(await hasCapability(scope.org.orgId, "org_knowledge"))) {
    return NextResponse.json(
      { error: "组织未开通机构知识沉淀能力" },
      { status: 403 }
    );
  }

  // 仅本人条目可晋升。
  const rows = await query<{ user_id: string }>(
    "SELECT user_id FROM knowledge_base_entries WHERE id = $1",
    [params.id]
  );
  const entry = rows[0];
  if (!entry || entry.user_id !== userId) {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }

  await query(
    `UPDATE knowledge_base_entries
        SET org_id = $1, visibility = 'org', promoted_by = $2, promoted_at = NOW()
      WHERE id = $3`,
    [scope.org.orgId, userId, params.id]
  );
  return NextResponse.json({ success: true });
}
