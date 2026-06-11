// DELETE /api/org/invitations/[id] — 撤销邀请（org admin，置 revoked）

import { NextResponse } from "next/server";
import { requireOrgAPI } from "@/lib/orgAuth";
import { query } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "邀请不存在" }, { status: 404 });
  }

  const rows = await query<{ id: string }>(
    `UPDATE org_invitations SET status = 'revoked'
      WHERE id = $1 AND org_id = $2 AND status = 'pending'
      RETURNING id`,
    [params.id, ctx.orgId]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "邀请不存在或已不是待处理状态" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
