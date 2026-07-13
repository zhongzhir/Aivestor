import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

interface ActionRow {
  id: string;
  title: string;
  owner: string | null;
  due_date: string | null;
  status: string;
  source_type: string;
  source_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "read");
    } catch (e) {
      return accessErrorResponse(e);
    }
    const child = scopedProjectChildWhere(scope, 2);
    const rows = await query<ActionRow>(
      `SELECT id, title, owner, due_date, status, source_type, source_id,
              note, created_at, updated_at
         FROM post_investment_action_items
        WHERE project_id = $1 AND ${child.sql}
        ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                 due_date ASC NULLS LAST, created_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ actions: rows });
  } catch (e) {
    console.error("[post-actions] GET 失败:", e);
    return NextResponse.json({ error: "读取行动项失败" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    let orgId: string | null = null;
    try {
      orgId = (await assertProjectAccess(scope, params.id, "write")).orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }

    const body = (await req.json()) as {
      title?: string;
      owner?: string;
      due_date?: string;
      note?: string;
      source_type?: string;
      source_id?: string;
    };
    const title = body.title?.trim();
    if (!title) return NextResponse.json({ error: "请填写行动项" }, { status: 422 });
    const sourceType = ["manual", "meeting", "update"].includes(body.source_type ?? "")
      ? body.source_type
      : "manual";
    const rows = await query<ActionRow>(
      `INSERT INTO post_investment_action_items
         (project_id, user_id, org_id, title, owner, due_date, note, source_type, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, owner, due_date, status, source_type, source_id,
                 note, created_at, updated_at`,
      [
        params.id,
        session.user.id,
        orgId,
        title,
        body.owner?.trim() || null,
        body.due_date || null,
        body.note?.trim() || null,
        sourceType,
        body.source_id || null,
      ]
    );
    return NextResponse.json({ action: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[post-actions] POST 失败:", e);
    return NextResponse.json({ error: "保存行动项失败" }, { status: 500 });
  }
}
