import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope, scopedProjectChildWhere } from "@/lib/resourceAccess";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    alias: "r",
    excludeMergedForAnalyst: true,
  });
  const rows = await query<{ kind: string; research_metadata: unknown }>(
    `SELECT r.kind, r.research_metadata
       FROM reports r
      WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  if (rows[0].kind !== "deep_research") {
    return NextResponse.json({ error: "该报告不是深度投研报告" }, { status: 400 });
  }
  return NextResponse.json({ researchMetadata: rows[0].research_metadata });
}
