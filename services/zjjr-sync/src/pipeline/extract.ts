// 特征提取（架构文档 v1.1 第 5.4 阶段 3）。
//   按 feature_kind 聚合统计：
//     - institution_profile ：机构画像（基础字段）
//     - activity_summary    ：近 12 月出手次数 + 轮次分布
//     - investment_preference：赛道集中度
//     - sector_trend        ：赛道层近 90 天事件聚合
//
// 纯统计，不调 LLM（narrate.ts 做模板自然语言化）。

import type {
  CleanInvestment,
  ExtractedFeature,
  ResolvedInstitution,
} from "../types";

function daysBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function distribution(values: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v && v.trim() ? v.trim() : "未知";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// 集中度（最大类占比，0–1）：用于赛道偏好的「集中/分散」判断。
function concentration(dist: Record<string, number>): number {
  const counts = Object.values(dist);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return Math.max(...counts) / total;
}

export interface ExtractInput {
  institutions: ResolvedInstitution[];
  investments: CleanInvestment[];
  instIdBySource: Map<string, string>; // sourceId → zjjr_institutions.id
  dataAsOf: string; // YYYY-MM-DD
}

export function extractFeatures(input: ExtractInput): ExtractedFeature[] {
  const { institutions, investments, instIdBySource, dataAsOf } = input;
  const features: ExtractedFeature[] = [];

  // 按机构分组投资事件。
  const dealsByInst = new Map<string, CleanInvestment[]>();
  for (const inv of investments) {
    const list = dealsByInst.get(inv.institutionSourceId) ?? [];
    list.push(inv);
    dealsByInst.set(inv.institutionSourceId, list);
  }

  for (const inst of institutions) {
    const instId = instIdBySource.get(inst.sourceId) ?? null;
    const deals = dealsByInst.get(inst.sourceId) ?? [];

    // --- institution_profile ---
    features.push({
      featureKind: "institution_profile",
      institutionId: instId,
      sector: null,
      title: `${inst.name} · 机构画像`,
      stats: {
        name: inst.name,
        institutionType: inst.institutionType,
        fundCount: inst.fundCount,
        manageScale: inst.manageScale,
        focusSectors: inst.focusSectors,
        focusStages: inst.focusStages,
        region: inst.region,
        regStatus: inst.regStatus,
        dealCount: deals.length,
      },
      dataAsOf,
    });

    // --- activity_summary：近 12 月出手次数 + 轮次分布 ---
    const last12mDeals = deals.filter((d) => {
      const gap = daysBetween(d.investedAt, dataAsOf);
      return gap !== null && gap >= 0 && gap <= 365;
    });
    features.push({
      featureKind: "activity_summary",
      institutionId: instId,
      sector: null,
      title: `${inst.name} · 近 12 月活跃度`,
      stats: {
        last12mCount: last12mDeals.length,
        totalKnownDeals: deals.length,
        stageDistribution: distribution(last12mDeals.map((d) => d.stage)),
        undatedDeals: deals.filter((d) => d.investedAt === null).length,
      },
      dataAsOf,
    });

    // --- investment_preference：赛道集中度 ---
    if (deals.length > 0) {
      const sectorDist = distribution(deals.map((d) => d.sector));
      features.push({
        featureKind: "investment_preference",
        institutionId: instId,
        sector: null,
        title: `${inst.name} · 赛道偏好`,
        stats: {
          sectorDistribution: sectorDist,
          concentration: Number(concentration(sectorDist).toFixed(2)),
          topSectors: Object.entries(sectorDist)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([s]) => s),
        },
        dataAsOf,
      });
    }
  }

  // --- sector_trend：赛道层近 90 天事件聚合（跨机构）---
  const recentBySector = new Map<string, CleanInvestment[]>();
  for (const inv of investments) {
    const gap = daysBetween(inv.investedAt, dataAsOf);
    if (gap === null || gap < 0 || gap > 90) continue;
    const sector = inv.sector && inv.sector.trim() ? inv.sector.trim() : "未分类";
    const list = recentBySector.get(sector) ?? [];
    list.push(inv);
    recentBySector.set(sector, list);
  }
  for (const [sector, deals] of recentBySector) {
    const activeInstitutions = new Set(deals.map((d) => d.institutionSourceId));
    features.push({
      featureKind: "sector_trend",
      institutionId: null,
      sector,
      title: `${sector} · 近 90 天动态`,
      stats: {
        dealCount: deals.length,
        activeInstitutionCount: activeInstitutions.size,
        stageDistribution: distribution(deals.map((d) => d.stage)),
        sampleTargets: deals.slice(0, 5).map((d) => d.targetCompany),
      },
      dataAsOf,
    });
  }

  return features;
}
