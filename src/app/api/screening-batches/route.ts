import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const batches = await query(
    `SELECT b.id, b.name, b.criteria, b.status, b.created_at, b.completed_at,
            COUNT(i.id)::int AS item_count,
            COUNT(i.id) FILTER (WHERE i.status = 'completed')::int AS completed_count,
            COUNT(i.id) FILTER (WHERE i.status = 'failed')::int AS failed_count
       FROM screening_batches b LEFT JOIN screening_items i ON i.batch_id = b.id
      WHERE b.user_id = $1 GROUP BY b.id ORDER BY b.created_at DESC`, [session.user.id]
  );
  return NextResponse.json({ batches });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: string; criteria?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "请填写批次名称" }, { status: 400 });
  const scope = await buildAccessScope(session.user.id);
  const rows = await query<{ id: string }>(
    `INSERT INTO screening_batches (user_id, org_id, name, criteria) VALUES ($1,$2,$3,$4) RETURNING id`,
    [session.user.id, scope.org?.orgId || null, name, body.criteria?.trim() || null]
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
