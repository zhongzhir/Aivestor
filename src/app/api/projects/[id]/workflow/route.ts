import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

interface WorkflowRow {
  next_action: string | null;
  next_action_due_at: string | null;
  evidence_completeness: number;
  workspace_note: string | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function cleanDueDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanCompleteness(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "write");
    } catch (e) {
      return accessErrorResponse(e);
    }

    let body: {
      nextAction?: unknown;
      nextActionDueAt?: unknown;
      evidenceCompleteness?: unknown;
      workspaceNote?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const rows = await query<WorkflowRow>(
      `UPDATE projects
          SET next_action = $1,
              next_action_due_at = $2,
              evidence_completeness = $3,
              workspace_note = $4,
              updated_at = NOW()
        WHERE id = $5
        RETURNING next_action, next_action_due_at, evidence_completeness, workspace_note`,
      [
        cleanText(body.nextAction),
        cleanDueDate(body.nextActionDueAt),
        cleanCompleteness(body.evidenceCompleteness),
        cleanText(body.workspaceNote),
        params.id,
      ]
    );

    return NextResponse.json({ workflow: rows[0] });
  } catch (e) {
    console.error("[project workflow] PATCH 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
