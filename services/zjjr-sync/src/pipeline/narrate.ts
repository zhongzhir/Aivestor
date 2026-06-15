// 自然语言化（架构文档 v1.1 第 5.4 阶段 4）。
//   模板拼接为主（统计类特征不需要 LLM），输出 200–400 字片段；
//   每段末尾内置数据截止日（data_as_of）。
//   有效期 valid_until（5.5）：
//     institution_profile / investment_preference = data_as_of + 90 天；
//     sector_trend / activity_summary             = data_as_of + 30 天（动态类时效短）。

import type { ExtractedFeature, NarratedFeature } from "../types";

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validUntilFor(kind: ExtractedFeature["featureKind"], asOf: string): string {
  const longLived = kind === "institution_profile" || kind === "investment_preference";
  return addDays(asOf, longLived ? 90 : 30);
}

function joinList(items: unknown, fallback = "暂无公开记录"): string {
  if (Array.isArray(items) && items.length > 0) return items.join("、");
  return fallback;
}

function distText(dist: Record<string, number> | undefined): string {
  if (!dist) return "暂无";
  const parts = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v} 笔`);
  return parts.length ? parts.join("，") : "暂无";
}

// 限定 200–400 字区间：过短补语境，过长截断（保底注脚仍保留）。
function clampLength(body: string): string {
  const MAX = 360; // 给末尾的数据截止日注脚留出余量（合计控制在 400 字内）
  if (body.length <= MAX) return body;
  return body.slice(0, MAX).replace(/[，。、；]?$/, "") + "……";
}

export function narrate(feature: ExtractedFeature): NarratedFeature {
  const s = feature.stats as Record<string, unknown>;
  let body = "";

  switch (feature.featureKind) {
    case "institution_profile": {
      body =
        `${s.name}是一家${s.institutionType ?? "投资"}机构，` +
        `注册地${s.region ?? "未披露"}，登记状态为${s.regStatus ?? "未披露"}。` +
        `该机构管理基金约 ${s.fundCount ?? "若干"} 只，管理规模${s.manageScale ?? "未披露"}。` +
        `重点关注${joinList(s.focusSectors, "多个赛道")}等领域，` +
        `主要投资阶段集中在${joinList(s.focusStages, "多个阶段")}。` +
        `公开可查的投资事件约 ${s.dealCount ?? 0} 笔。`;
      break;
    }
    case "activity_summary": {
      body =
        `近 12 个月内，该机构公开披露的出手约 ${s.last12mCount ?? 0} 笔` +
        `（已知投资事件合计 ${s.totalKnownDeals ?? 0} 笔）。` +
        `轮次分布：${distText(s.stageDistribution as Record<string, number>)}。` +
        (Number(s.undatedDeals) > 0
          ? `另有 ${s.undatedDeals} 笔事件投资日期未公开，未计入近 12 月口径。`
          : "");
      break;
    }
    case "investment_preference": {
      const conc = Number(s.concentration ?? 0);
      const concWord = conc >= 0.6 ? "较为集中" : conc >= 0.4 ? "相对集中" : "较为分散";
      body =
        `从已知投资事件看，该机构的赛道偏好${concWord}` +
        `（最大赛道占比约 ${(conc * 100).toFixed(0)}%）。` +
        `重点赛道为${joinList(s.topSectors, "暂不明确")}。` +
        `各赛道分布：${distText(s.sectorDistribution as Record<string, number>)}。`;
      break;
    }
    case "sector_trend": {
      body =
        `${feature.sector}赛道近 90 天公开披露投资事件约 ${s.dealCount ?? 0} 笔，` +
        `涉及活跃机构约 ${s.activeInstitutionCount ?? 0} 家。` +
        `轮次分布：${distText(s.stageDistribution as Record<string, number>)}。` +
        `代表性被投企业：${joinList(s.sampleTargets, "暂无")}。`;
      break;
    }
  }

  body = clampLength(body);
  // 末尾内置数据截止日（注入标注用，5.5）。
  const content = `${body}（数据截止 ${feature.dataAsOf}，来源：中鉴基金研究院，仅供参考）`;

  return {
    ...feature,
    content,
    validUntil: validUntilFor(feature.featureKind, feature.dataAsOf),
  };
}

export function narrateAll(features: ExtractedFeature[]): NarratedFeature[] {
  return features.map(narrate);
}
