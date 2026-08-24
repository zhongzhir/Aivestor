import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { kickScreeningBatch } from "@/lib/screening";

export async function GET(_req: Request, { params }: { params: { batchId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const batches = await query(
    `SELECT id, name, criteria, status, created_at, started_at, completed_at FROM screening_batches WHERE id = $1 AND user_id = $2`,
    [params.batchId, session.user.id]
  );
  if (!batches[0]) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  const items = await query(
    `SELECT id, name, filename, status, result, error, retry_count, promoted_project_id, created_at
       FROM screening_items WHERE batch_id = $1 AND user_id = $2 ORDER BY created_at`,
    [params.batchId, session.user.id]
  );
  if ((batches[0] as { status: string }).status === "processing") kickScreeningBatch(params.batchId);
  return NextResponse.json({ batch: batches[0], items });
}
