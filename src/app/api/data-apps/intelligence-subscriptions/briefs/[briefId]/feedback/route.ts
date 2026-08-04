import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCapabilityAPI } from "@/lib/orgAuth";

export async function POST(request: Request, { params }: { params: { briefId: string } }) {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;
  const body = await request.json() as { itemKey?: string; feedback?: string };
  if (!body.itemKey || !["valuable", "irrelevant"].includes(body.feedback ?? "")) return NextResponse.json({ error: "反馈参数无效" }, { status: 400 });
  const rows = await query(`INSERT INTO intelligence_feedback (task_id,brief_id,user_id,item_key,feedback) SELECT task_id,id,user_id,$1,$2 FROM intelligence_briefs WHERE id=$3 AND user_id=$4 ON CONFLICT (user_id,task_id,brief_id,item_key) DO UPDATE SET feedback=EXCLUDED.feedback RETURNING *`, [body.itemKey, body.feedback, params.briefId, guard.ctx.userId]);
  if (!rows[0]) return NextResponse.json({ error: "简报不存在" }, { status: 404 });
  return NextResponse.json({ feedback: rows[0] });
}
