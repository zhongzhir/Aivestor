import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";
import { canUseDeepResearchBeta } from "@/lib/deepResearchAccess";
import { conversationResearchTasks, updateConversationResearchTask } from "@/lib/projectResearchTasks";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const tasks = await canUseDeepResearchBeta(session.user.id) ? await query<{ priority: string; status: string }>(
    `SELECT id, report_id, evidence_item_id, title, details, priority,
            status, owner, due_date, created_at, updated_at
       FROM deep_research_tasks
      WHERE project_id = $1
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
               CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
               created_at DESC`,
    [params.id]
  ) : [];
  const combined = [...await conversationResearchTasks(params.id), ...tasks];
  combined.sort((a, b) => a.priority.localeCompare(b.priority) || Number(["done", "dismissed"].includes(a.status)) - Number(["done", "dismissed"].includes(b.status)));
  return NextResponse.json({ tasks: combined });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { taskId?: unknown; status?: unknown; owner?: unknown; dueDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (typeof body.taskId !== "string") return NextResponse.json({ error: "缺少任务ID" }, { status: 422 });
  if (body.status != null && !["open", "in_progress", "done", "dismissed"].includes(String(body.status))) {
    return NextResponse.json({ error: "任务状态无效" }, { status: 422 });
  }
  if (Object.prototype.hasOwnProperty.call(body, "owner") && body.owner != null && typeof body.owner !== "string") {
    return NextResponse.json({ error: "负责人格式无效" }, { status: 422 });
  }
  if (body.dueDate != null && body.dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate))) {
    return NextResponse.json({ error: "截止日期无效" }, { status: 422 });
  }
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "write");
  } catch (error) {
    return accessErrorResponse(error);
  }
  if (body.taskId.startsWith("conversation:")) {
    try { return NextResponse.json({ task: await updateConversationResearchTask(params.id, body.taskId, body) }); }
    catch (error) { return accessErrorResponse(error); }
  }
  if (!(await canUseDeepResearchBeta(session.user.id))) {
    return NextResponse.json({ error: "功能未开放" }, { status: 404 });
  }
  const rows = await query(
    `UPDATE deep_research_tasks
        SET status = COALESCE($1, status),
            owner = CASE WHEN $2::boolean THEN NULLIF($3, '') ELSE owner END,
            due_date = CASE WHEN $4::boolean THEN NULLIF($5, '')::date ELSE due_date END,
            updated_at = NOW()
      WHERE id = $6 AND project_id = $7
      RETURNING id, report_id, evidence_item_id, title, details, priority,
                status, owner, due_date, created_at, updated_at`,
    [
      body.status == null ? null : String(body.status),
      Object.prototype.hasOwnProperty.call(body, "owner"),
      body.owner == null ? "" : String(body.owner).trim().slice(0, 120),
      Object.prototype.hasOwnProperty.call(body, "dueDate"),
      body.dueDate == null ? "" : String(body.dueDate),
      body.taskId,
      params.id,
    ]
  );
  if (!rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ task: rows[0] });
}
