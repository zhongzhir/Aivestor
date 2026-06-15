import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCapabilityAPI } from "@/lib/orgAuth";
import { consumeLookupQuota } from "@/lib/dataAppRateLimit";

export const dynamic = "force-dynamic";

interface InstRow {
  id: string;
  name: string;
  institution_type: string | null;
  region: string | null;
  reg_status: string | null;
  manage_scale: string | null;
  fund_count: number | null;
  focus_sectors: string[];
  focus_stages: string[];
  data_as_of: string | null;
}

interface DealRow {
  target_company: string;
  stage: string | null;
  invested_at: string | null;
}

// GET /api/data-apps/institutions/[id] —— 单机构详情（架构 6.3）。
//   requireCapabilityAPI('zjjr_data') + 60 次/小时频控；返回限定字段 +
//   近 12 月出手次数 + 最近 3 条投资事件（不返回完整投资清单 / 金额详情）。
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;

  const { limited } = consumeLookupQuota(guard.ctx.userId);
  if (limited) {
    return NextResponse.json(
      { error: "点查过于频繁，请稍后再试（每小时上限 60 次）" },
      { status: 429 }
    );
  }

  try {
    const instRows = await query<InstRow>(
      `SELECT id, name, institution_type, region, reg_status, manage_scale,
              fund_count, focus_sectors, focus_stages,
              source_updated_at::text AS data_as_of
         FROM zjjr_institutions
        WHERE id = $1
        LIMIT 1`,
      [params.id]
    );
    const inst = instRows[0];
    if (!inst) {
      return NextResponse.json({ error: "未找到机构" }, { status: 404 });
    }

    const [countRows, recentDeals] = await Promise.all([
      query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
           FROM zjjr_investments
          WHERE institution_id = $1
            AND invested_at IS NOT NULL
            AND invested_at >= (CURRENT_DATE - INTERVAL '12 months')`,
        [params.id]
      ),
      query<DealRow>(
        `SELECT target_company, stage, invested_at::text AS invested_at
           FROM zjjr_investments
          WHERE institution_id = $1
          ORDER BY invested_at DESC NULLS LAST
          LIMIT 3`,
        [params.id]
      ),
    ]);

    return NextResponse.json({
      institution: inst,
      last12mDealCount: Number(countRows[0]?.c) || 0,
      recentDeals,
    });
  } catch {
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}
