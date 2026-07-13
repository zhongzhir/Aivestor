import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; actionId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "write");
    } catch (e) {
      return accessErrorResponse(e);
    }
    const body = (await req.json()) as { status?: string };
    if (!body.status || !["open", "in_progress", "done", "cancelled"].includes(body.status)) {
      return NextResponse.json({ error: "行动项状态无效" }, { status: 422 });
    }
    const child = scopedProjectChildWhere(scope, 4);
    const rows = await query(
      `UPDATE post_investment_action_items
          SET status = $1
        WHERE id = $2 AND project_id = $3 AND ${child.sql}
       RETURNING id, title, owner, due_date, status, source_type, source_id,
                 note, created_at, updated_at`,
      [body.status, params.actionId, params.id, ...child.params]
    );
    if (rows.length === 0) return NextResponse.json({ error: "行动项不存在" }, { status: 404 });
    return NextResponse.json({ action: rows[0] });
  } catch (e) {
    console.error("[post-actions] PATCH 失败:", e);
    return NextResponse.json({ error: "更新行动项失败" }, { status: 500 });
  }
}
