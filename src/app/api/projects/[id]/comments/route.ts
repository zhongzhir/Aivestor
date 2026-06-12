import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

interface CommentRow {
  id: string;
  user_id: string;
  user_name: string | null;
  content: string;
  reply_to: string | null;
  created_at: string;
}

// GET /api/projects/[id]/comments — 评论列表（项目可见者，仅组织项目）
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  let orgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, params.id, "read");
    orgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }
  if (!orgId) {
    // 个人项目无评论概念
    return NextResponse.json({ comments: [] });
  }

  const comments = await query<CommentRow>(
    `SELECT c.id, c.user_id, u.name AS user_name, c.content,
            c.reply_to, c.created_at
       FROM project_comments c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.project_id = $1
      ORDER BY c.created_at ASC`,
    [params.id]
  );
  return NextResponse.json({ comments });
}

// POST /api/projects/[id]/comments — 发评论（仅组织项目）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  let orgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, params.id, "read");
    orgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }
  if (!orgId) {
    return NextResponse.json(
      { error: "仅组织项目可评论" },
      { status: 400 }
    );
  }

  let body: { content?: string; reply_to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "评论内容不能为空" }, { status: 422 });
  }

  const rows = await query<{ id: string; created_at: string }>(
    `INSERT INTO project_comments (project_id, org_id, user_id, content, reply_to)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [params.id, orgId, session.user.id, content, body.reply_to || null]
  );
  return NextResponse.json({ id: rows[0].id, created_at: rows[0].created_at }, {
    status: 201,
  });
}
