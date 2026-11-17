import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";

interface ConversationRow {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/conversations/[id] — 完整对话
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const rows = await query<ConversationRow>(
    `SELECT c.id, c.title, c.project_id, p.name AS project_name,
            c.messages, c.summary, c.created_at, c.updated_at
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
      WHERE c.id = $1 AND c.user_id = $2`,
    [params.id, session.user.id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  if (rows[0].project_id) {
    try { await assertProjectAccess(await buildAccessScope(session.user.id), rows[0].project_id, "read"); }
    catch (error) { return accessErrorResponse(error); }
  }
  return NextResponse.json({ conversation: rows[0] });
}

// Associate free discussions without mixing two projects' histories.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { project_id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  if (body.project_id !== null && (typeof body.project_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.project_id))) {
    return NextResponse.json({ error: "请选择项目" }, { status: 400 });
  }
  const [conversation] = await query<{ project_id: string | null; messages: unknown[] }>(
    "SELECT project_id, messages FROM conversations WHERE id = $1 AND user_id = $2", [params.id, session.user.id]);
  if (!conversation) return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  const scope = await buildAccessScope(session.user.id);
  try {
    if (conversation.project_id) await assertProjectAccess(scope, conversation.project_id, "read");
    if (body.project_id) await assertProjectAccess(scope, body.project_id as string, "read");
  } catch (error) { return accessErrorResponse(error); }
  if (conversation.project_id && conversation.project_id !== body.project_id && conversation.messages.length) {
    return NextResponse.json({ error: "切换项目请新建对话，原研究记录会保留" }, { status: 409 });
  }
  const updated = await query(
    `UPDATE conversations SET project_id = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND project_id IS NOT DISTINCT FROM $4::uuid AND messages = $5::jsonb RETURNING id`,
    [body.project_id, params.id, session.user.id, conversation.project_id, JSON.stringify(conversation.messages)]);
  if (!updated.length) return NextResponse.json({ error: "对话已更新，请重新打开后关联" }, { status: 409 });
  return NextResponse.json({ success: true });
}

// DELETE /api/conversations/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  await query(
    "DELETE FROM conversations WHERE id = $1 AND user_id = $2",
    [params.id, session.user.id]
  );
  return NextResponse.json({ success: true });
}
