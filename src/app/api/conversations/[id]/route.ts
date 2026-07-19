import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

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
  return NextResponse.json({ conversation: rows[0] });
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
