import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { pool } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

// POST /api/projects/[id]/transfer-to-org — 个人项目转入组织（架构文档 2.4）
// 一个事务内把项目及其全部子资产打上 org_id，owner_id 置为操作者。
// 知识库条目不随项目转移（个人判断层语义）。不可逆。
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
  if (!scope.org || !(await hasCapability(scope.org.orgId, "collaboration"))) {
    return NextResponse.json(
      { error: "当前组织未开通协作能力，无法转入项目" },
      { status: 403 }
    );
  }
  const orgId = scope.org.orgId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 仅本人的纯个人项目（org_id IS NULL）可转入。
    const proj = await client.query(
      `UPDATE projects SET org_id = $1, owner_id = $2
        WHERE id = $3 AND user_id = $2 AND org_id IS NULL`,
      [orgId, userId, params.id]
    );
    if (proj.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "项目不存在、非本人项目或已属于组织" },
        { status: 404 }
      );
    }

    // 五张子表跟随打 org_id（仅本人创建的行）
    for (const table of [
      "documents",
      "reports",
      "investment_judgments",
      "meeting_notes",
      "post_investment_updates",
    ]) {
      await client.query(
        `UPDATE ${table} SET org_id = $1 WHERE project_id = $2 AND user_id = $3`,
        [orgId, params.id, userId]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[transfer-to-org] 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "转入失败" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
