import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCapabilityAPI } from "@/lib/orgAuth";

export const dynamic = "force-dynamic";

interface InsightRow {
  id: string;
  period: string;
  period_kind: "weekly" | "monthly";
  title: string;
  content: string;
  data_as_of: string;
  generated_at: string;
}

// GET /api/data-apps/market-insights —— 市场洞察列表（架构 6.2）。
//   requireCapabilityAPI('zjjr_data')；weekly 最近 4 条 + monthly 最近 3 条，
//   按 generated_at 降序。表为空（Fixture 状态/未跑生成器）返回空数组，非错误。
export async function GET() {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;

  try {
    const [weekly, monthly] = await Promise.all([
      query<InsightRow>(
        `SELECT id, period, period_kind, title, content,
                data_as_of::text AS data_as_of, generated_at
           FROM market_insights
          WHERE period_kind = 'weekly'
          ORDER BY generated_at DESC
          LIMIT 4`
      ),
      query<InsightRow>(
        `SELECT id, period, period_kind, title, content,
                data_as_of::text AS data_as_of, generated_at
           FROM market_insights
          WHERE period_kind = 'monthly'
          ORDER BY generated_at DESC
          LIMIT 3`
      ),
    ]);
    return NextResponse.json({ insights: [...weekly, ...monthly] });
  } catch {
    // 迁移 029 未执行 / 表不存在 → 视为空，前端走空态。
    return NextResponse.json({ insights: [] });
  }
}
