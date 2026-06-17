import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireCapabilityAPI } from "@/lib/orgAuth";
import { consumeLookupQuota, clientIpFrom } from "@/lib/dataAppRateLimit";

export const dynamic = "force-dynamic";

interface SearchRow {
  id: string;
  name: string;
  institution_type: string | null;
  region: string | null;
  reg_status: string | null;
  manage_scale: string | null;
  focus_sectors: string[];
  focus_stages: string[];
  data_as_of: string | null;
}

// GET /api/data-apps/institutions/search?q= —— 机构点查搜索（架构 6.3）。
//   requireCapabilityAPI('zjjr_data') + 60 次/小时频控；pg_trgm 模糊匹配
//   canonical_name/name，最多 10 条；字段范围限定（不返回 raw / 完整投资清单）。
export async function GET(req: NextRequest) {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;

  const { limited } = await consumeLookupQuota(
    guard.ctx.userId,
    clientIpFrom(req)
  );
  if (limited) {
    return NextResponse.json(
      { error: "点查过于频繁，请稍后再试（每小时上限 60 次）" },
      { status: 429 }
    );
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [], dataAsOf: null });

  try {
    const rows = await query<SearchRow>(
      `SELECT id, name, institution_type, region, reg_status, manage_scale,
              focus_sectors, focus_stages,
              source_updated_at::text AS data_as_of
         FROM zjjr_institutions
        WHERE name ILIKE '%' || $1 || '%'
           OR canonical_name ILIKE '%' || $1 || '%'
           OR name % $1
           OR canonical_name % $1
        ORDER BY GREATEST(similarity(name, $1), similarity(canonical_name, $1)) DESC,
                 name ASC
        LIMIT 10`,
      [q]
    );

    // 页脚免责声明用的数据截止日：取结果中最新的 source_updated_at。
    const dataAsOf = rows
      .map((r) => r.data_as_of)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;

    return NextResponse.json({ results: rows, dataAsOf });
  } catch {
    // 迁移 028 未执行 / 无数据 → 空结果，前端走空态。
    return NextResponse.json({ results: [], dataAsOf: null });
  }
}
