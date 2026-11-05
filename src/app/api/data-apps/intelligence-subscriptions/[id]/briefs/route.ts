import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { decodeIntelligenceCursor, encodeIntelligenceCursor } from "@/lib/intelligenceCursor";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const owned = await query<{ id: string }>("SELECT id FROM intelligence_tasks WHERE id=$1 AND user_id=$2", [params.id, guard.access.userId]);
  if (!owned[0]) return NextResponse.json({ error: "情报主题不存在" }, { status: 404 });
  const cursor = decodeIntelligenceCursor(url.searchParams.get("cursor"));
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 10));
  const rows = await query<Record<string, unknown>>(
    `SELECT b.id,b.task_id,b.task_name,b.coverage_start,b.coverage_end,b.generated_at,
            b.item_count,b.important_facts,b.trend_signals,b.other_items,b.source_list,
            b.metadata,b.run_id,b.schema_version,
            r.status AS run_status,r.trigger_type,r.error_code,r.error_message_safe
       FROM intelligence_briefs b
       LEFT JOIN intelligence_runs r ON r.id=b.run_id AND r.user_id=b.user_id
      WHERE b.user_id=$1 AND b.task_id=$2
        AND ($3::timestamptz IS NULL OR (b.generated_at,b.id) < ($3::timestamptz,$4::uuid))
      ORDER BY b.generated_at DESC,b.id DESC
      LIMIT $5`,
    [guard.access.userId, params.id, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );
  const hasMore = rows.length > limit;
  const briefs = rows.slice(0, limit);
  const last = briefs[briefs.length - 1] as { generated_at?: unknown; id?: unknown } | undefined;
  const nextCursor = hasMore && typeof last?.generated_at === "string" && typeof last.id === "string"
    ? encodeIntelligenceCursor({ createdAt: last.generated_at, id: last.id })
    : null;
  return NextResponse.json({ briefs, nextCursor });
}
