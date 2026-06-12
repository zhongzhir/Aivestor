import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidMeetingType } from "@/lib/postInvestment";
import {
  buildAccessScope,
  assertProjectAccess,
  scopedProjectChildWhere,
  accessErrorResponse,
} from "@/lib/resourceAccess";

interface MeetingRow {
  id: string;
  title: string;
  meeting_date: string | null;
  meeting_type: string;
  participants: string[];
  content: string;
  ai_summary: unknown;
  next_meeting_date: string | null;
  created_at: string;
}

// 把参与方输入（字符串或数组）归一化为字符串数组
function normalizeParticipants(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((p) => String(p).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[,，、;；]/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [];
}

// GET /api/projects/[id]/meetings — 项目所有会议记录
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
    const rows = await query<MeetingRow>(
      `SELECT id, title, meeting_date, meeting_type, participants,
              content, ai_summary, next_meeting_date, created_at
         FROM meeting_notes
        WHERE project_id = $1 AND ${child.sql}
        ORDER BY meeting_date DESC NULLS LAST, created_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ meetings: rows });
  } catch (e) {
    console.error("[meetings] GET 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/meetings — 新增会议记录
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

    let body: {
      title?: string;
      meeting_date?: string;
      meeting_type?: string;
      participants?: unknown;
      content?: string;
      next_meeting_date?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!title) {
      return NextResponse.json({ error: "请填写会议标题" }, { status: 422 });
    }
    if (!body.meeting_date) {
      return NextResponse.json({ error: "请选择会议日期" }, { status: 422 });
    }
    if (!content) {
      return NextResponse.json({ error: "请填写会议内容" }, { status: 422 });
    }
    const meetingType =
      body.meeting_type && isValidMeetingType(body.meeting_type)
        ? body.meeting_type
        : "regular";

    const rows = await query<MeetingRow>(
      `INSERT INTO meeting_notes
         (user_id, project_id, title, meeting_date, meeting_type,
          participants, content, next_meeting_date, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, meeting_date, meeting_type, participants,
                 content, ai_summary, next_meeting_date, created_at`,
      [
        session.user.id,
        params.id,
        title,
        body.meeting_date,
        meetingType,
        JSON.stringify(normalizeParticipants(body.participants)),
        content,
        body.next_meeting_date || null,
        projectOrgId,
      ]
    );

    return NextResponse.json({ meeting: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[meetings] POST 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
