import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidStage } from "@/lib/stages";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

const EVENT_TYPES = [
  "stage_gate",
  "project_approval",
  "ic_memo",
  "ic_decision",
  "term_decision",
  "post_investment",
  "exit_decision",
] as const;

const STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "deferred",
  "needs_more",
  "recorded",
] as const;

type EventType = (typeof EVENT_TYPES)[number];
type EventStatus = (typeof STATUSES)[number];

interface DecisionEventRow {
  id: string;
  stage: string;
  event_type: string;
  status: string;
  title: string;
  note: string | null;
  created_at: string;
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPES.includes(value as EventType);
}

function isStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && STATUSES.includes(value as EventStatus);
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

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

    const rows = await query<DecisionEventRow>(
      `SELECT id, stage, event_type, status, title, note, created_at
         FROM project_decision_events
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [params.id]
    );

    return NextResponse.json({ events: rows });
  } catch (e) {
    console.error("[decision-events] GET failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取节点记录失败" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: {
      stage?: string;
      event_type?: string;
      status?: string;
      title?: string;
      note?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    if (!isValidStage(body.stage)) {
      return NextResponse.json({ error: "节点阶段不合法" }, { status: 422 });
    }
    if (!isEventType(body.event_type)) {
      return NextResponse.json({ error: "节点类型不合法" }, { status: 422 });
    }
    if (!isStatus(body.status)) {
      return NextResponse.json({ error: "节点状态不合法" }, { status: 422 });
    }

    const title = cleanText(body.title, 120);
    if (!title) {
      return NextResponse.json({ error: "请填写节点标题" }, { status: 422 });
    }

    const scope = await buildAccessScope(session.user.id);
    let orgId: string | null = null;
    try {
      const info = await assertProjectAccess(scope, params.id, "write");
      orgId = info.orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }

    const rows = await query<DecisionEventRow>(
      `INSERT INTO project_decision_events
         (project_id, user_id, org_id, stage, event_type, status, title, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, stage, event_type, status, title, note, created_at`,
      [
        params.id,
        session.user.id,
        orgId,
        body.stage,
        body.event_type,
        body.status,
        title,
        cleanText(body.note, 2000),
      ]
    );

    await query(
      `UPDATE projects
          SET process_stage = $1,
              process_stage_updated_at = NOW()
        WHERE id = $2`,
      [body.stage, params.id]
    );

    return NextResponse.json({ event: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[decision-events] POST failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存节点记录失败" },
      { status: 500 }
    );
  }
}
