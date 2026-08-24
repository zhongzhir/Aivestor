import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { kickScreeningBatch } from "@/lib/screening";

export async function POST(_req: Request, { params }: { params: { batchId: string; itemId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rows = await query<{ id: string }>(
    `UPDATE screening_items SET status='pending', error=NULL, retry_count=retry_count+1
      WHERE id=$1 AND batch_id=$2 AND user_id=$3 AND status='failed' RETURNING id`,
    [params.itemId, params.batchId, session.user.id]
  );
  if (!rows[0]) return NextResponse.json({ error: "该候选当前不能重试" }, { status: 409 });
  await query("UPDATE screening_batches SET status='processing', completed_at=NULL WHERE id=$1 AND user_id=$2", [params.batchId, session.user.id]);
  kickScreeningBatch(params.batchId);
  return NextResponse.json({ ok: true });
}
