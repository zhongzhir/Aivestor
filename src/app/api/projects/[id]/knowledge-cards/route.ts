import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const scope = await buildAccessScope(session.user.id);
    await assertProjectAccess(scope, params.id, "read");
    const cards = await query(
      `SELECT id, title, content, entry_type, source_type, created_at
         FROM knowledge_base_entries
        WHERE project_id = $1
          AND (user_id = $2 OR (org_id = $3 AND visibility = 'org'))
        ORDER BY created_at DESC
        LIMIT 8`,
      [params.id, session.user.id, scope.org?.orgId ?? null]
    );
    return NextResponse.json({ cards });
  } catch (e) {
    try { return accessErrorResponse(e); } catch { return NextResponse.json({ error: "读取项目知识失败" }, { status: 500 }); }
  }
}
