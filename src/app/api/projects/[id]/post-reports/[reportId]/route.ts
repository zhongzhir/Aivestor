import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";

export async function PATCH(req: Request, { params }: { params: { id: string; reportId: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    try { await assertProjectAccess(scope, params.id, "write"); } catch (e) { return accessErrorResponse(e); }
    const body = (await req.json()) as { review_status?: string };
    if (!body.review_status || !["draft", "in_review", "approved", "archived"].includes(body.review_status)) return NextResponse.json({ error: "评审状态无效" }, { status: 422 });
    const rows = await query(
      `UPDATE post_investment_report_meta m SET review_status = $1, updated_at = now()
        FROM reports r WHERE m.report_id = r.id AND m.report_id = $2 AND r.project_id = $3
       RETURNING m.report_id, m.review_status`,
      [body.review_status, params.reportId, params.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: "投后报告不存在" }, { status: 404 });
    await query("UPDATE reports SET status = $1 WHERE id = $2", [body.review_status === "approved" ? "finalized" : "draft", params.reportId]);
    return NextResponse.json({ report: rows[0] });
  } catch (e) {
    console.error("[post-reports] PATCH 失败:", e);
    return NextResponse.json({ error: "更新评审状态失败" }, { status: 500 });
  }
}
