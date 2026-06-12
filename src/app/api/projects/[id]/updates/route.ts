import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidUpdateType } from "@/lib/postInvestment";
import {
  buildAccessScope,
  assertProjectAccess,
  scopedProjectChildWhere,
  accessErrorResponse,
} from "@/lib/resourceAccess";

interface UpdateRow {
  id: string;
  update_type: string;
  content: string;
  period: string | null;
  created_at: string;
}

// GET /api/projects/[id]/updates — 项目所有投后跟踪记录
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "read");
    } catch (e) {
      return accessErrorResponse(e);
    }
    const child = scopedProjectChildWhere(scope, 2);
    const rows = await query<UpdateRow>(
      `SELECT id, update_type, content, period, created_at
         FROM post_investment_updates
        WHERE project_id = $1 AND ${child.sql}
        ORDER BY created_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ updates: rows });
  } catch (e) {
    console.error("[updates] GET 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/updates — 新增投后跟踪记录
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const scope = await buildAccessScope(session.user.id);
    let projectOrgId: string | null = null;
    try {
      const info = await assertProjectAccess(scope, params.id, "write");
      projectOrgId = info.orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }

    let body: { update_type?: string; content?: string; period?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const content = body.content?.trim();
    if (!content) {
      return NextResponse.json({ error: "请填写更新内容" }, { status: 422 });
    }
    const updateType =
      body.update_type && isValidUpdateType(body.update_type)
        ? body.update_type
        : "regular";

    const rows = await query<UpdateRow>(
      `INSERT INTO post_investment_updates
         (user_id, project_id, update_type, content, period, org_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, update_type, content, period, created_at`,
      [
        session.user.id,
        params.id,
        updateType,
        content,
        body.period?.trim() || null,
        projectOrgId,
      ]
    );

    return NextResponse.json({ update: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[updates] POST 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
