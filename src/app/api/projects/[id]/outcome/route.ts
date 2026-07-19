import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidOutcome } from "@/lib/outcome";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

// PATCH /api/projects/[id]/outcome — 更新项目投资结果
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { outcome?: string; outcome_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!isValidOutcome(body.outcome)) {
    return NextResponse.json({ error: "结果值不合法" }, { status: 422 });
  }

  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "write");
  } catch (e) {
    return accessErrorResponse(e);
  }

  const rows = await query<{
    id: string;
    outcome: string;
    outcome_note: string | null;
    outcome_at: string | null;
  }>(
    `UPDATE projects
        SET outcome = $1, outcome_note = $2, outcome_at = NOW()
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING id, outcome, outcome_note, outcome_at`,
    [
      body.outcome,
      body.outcome_note?.trim() || null,
      params.id,
    ]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ project: rows[0] });
}
