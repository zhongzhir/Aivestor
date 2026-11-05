import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";

export async function GET(_request: Request, { params }: { params: { briefId: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const brief = await query<{ id: string }>(
    "SELECT id FROM intelligence_briefs WHERE id=$1 AND user_id=$2",
    [params.briefId, guard.access.userId]
  );
  if (!brief[0]) return NextResponse.json({ error: "简报不存在" }, { status: 404 });
  const feedback = await query<{ item_key: string; feedback: string }>(
    "SELECT item_key,feedback FROM intelligence_feedback WHERE brief_id=$1 AND user_id=$2 ORDER BY created_at ASC",
    [params.briefId, guard.access.userId]
  );
  return NextResponse.json({ feedback });
}

export async function POST(request: Request, { params }: { params: { briefId: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const brief = await query<{ id: string }>(
    "SELECT id FROM intelligence_briefs WHERE id=$1 AND user_id=$2",
    [params.briefId, guard.access.userId]
  );
  if (!brief[0]) return NextResponse.json({ error: "简报不存在" }, { status: 404 });

  let body: { itemKey?: string; feedback?: string };
  try {
    body = await request.json() as { itemKey?: string; feedback?: string };
  } catch {
    return NextResponse.json({ error: "反馈参数无效" }, { status: 400 });
  }
  if (!body.itemKey || !["valuable", "irrelevant"].includes(body.feedback ?? "")) return NextResponse.json({ error: "反馈参数无效" }, { status: 400 });
  const rows = await query(`INSERT INTO intelligence_feedback (task_id,brief_id,user_id,item_key,feedback) SELECT task_id,id,user_id,$1,$2 FROM intelligence_briefs WHERE id=$3 AND user_id=$4 ON CONFLICT (user_id,brief_id,item_key) DO UPDATE SET feedback=EXCLUDED.feedback RETURNING *`, [body.itemKey, body.feedback, params.briefId, guard.access.userId]);
  if (!rows[0]) return NextResponse.json({ error: "简报不存在" }, { status: 404 });
  return NextResponse.json({ feedback: rows[0] });
}
