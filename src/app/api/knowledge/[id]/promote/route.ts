import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

// POST /api/knowledge/[id]/promote — 把个人条目晋升到机构沉淀层（架构文档 3.4 修订）
// 晋升是"复制不是移动"：个人层原记录永不变动，机构层 INSERT 一份独立副本，
// 通过 source_entry_id 关联回原记录。校验本人条目 + org_knowledge 能力位。
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

  // 仅本人、仍在个人层（未被复制过）的原记录可晋升。
  const rows = await query<{ user_id: string; visibility: string }>(
    "SELECT user_id, visibility FROM knowledge_base_entries WHERE id = $1",
    [params.id]
  );
  const entry = rows[0];
  if (!entry || entry.user_id !== userId || entry.visibility !== "private") {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }

  // 防重复：本 org 内已存在指向该原记录的副本则直接返回，不再 INSERT。
  const dup = await query<{ id: string }>(
    `SELECT id FROM knowledge_base_entries
      WHERE source_entry_id = $1 AND org_id = $2 AND visibility = 'org'`,
    [params.id, scope.org.orgId]
  );
  if (dup.length > 0) {
    return NextResponse.json({ success: true, alreadyShared: true });
  }

  // INSERT 副本：内容字段沿用原记录；归属/可见性/晋升痕迹/source_entry_id 新设。
  await query(
    `INSERT INTO knowledge_base_entries
        (user_id, content, source_type, entry_type, structured_data, tags,
         metadata, embedding, embedding_model,
         org_id, visibility, promoted_by, promoted_at, source_entry_id)
     SELECT user_id, content, source_type, entry_type, structured_data, tags,
            metadata, embedding, embedding_model,
            $1, 'org', $2, NOW(), id
       FROM knowledge_base_entries
      WHERE id = $3`,
    [scope.org.orgId, userId, params.id]
  );
  return NextResponse.json({ success: true });
}
