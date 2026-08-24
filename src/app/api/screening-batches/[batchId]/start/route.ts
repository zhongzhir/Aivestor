import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { kickScreeningBatch } from "@/lib/screening";

export async function POST(_req: Request, { params }: { params: { batchId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await query<{ id: string }>(
    `UPDATE screening_batches SET status = 'processing', started_at = COALESCE(started_at, now()), completed_at = NULL
      WHERE id = $1 AND user_id = $2 AND status IN ('draft','completed_with_errors')
        AND EXISTS (SELECT 1 FROM screening_items WHERE batch_id = $1 AND status IN ('pending','failed')) RETURNING id`,
    [params.batchId, session.user.id]
  );
  if (!rows[0]) return NextResponse.json({ error: "批次没有可处理的候选项目" }, { status: 409 });
  await query("UPDATE screening_items SET status = 'pending', error = NULL WHERE batch_id = $1 AND status = 'failed'", [params.batchId]);
  kickScreeningBatch(params.batchId);
  return NextResponse.json({ ok: true });
}
