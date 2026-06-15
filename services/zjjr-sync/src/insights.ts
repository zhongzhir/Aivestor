// 市场洞察预生成（架构文档 v1.1 第六部分 data-apps「市场洞察」的数据底稿）。
//
// 本期（P5）只留骨架，实现留到 P6 数据应用框架。
// 设计意图：同步收尾后，基于 zjjr_investments / zjjr_features 预聚合「近 N 天市场动态」
//   （活跃赛道、活跃机构、典型轮次），落到一张洞察快照表 / 或 zjjr_features 的
//   feature_kind='sector_trend' 之上，供 /data-apps/market-insights 直接读取，
//   避免前端实时聚合。预生成产物的承载表设计待 P6 与 6.x 一并定稿。

import type { PoolClient } from "pg";

export interface InsightsResult {
  generated: number;
  skipped: boolean;
  note: string;
}

// P6 实现占位：当前不生成任何洞察，返回 skipped。
export async function generateMarketInsights(
  _client: PoolClient,
  _opts?: { windowDays?: number }
): Promise<InsightsResult> {
  return {
    generated: 0,
    skipped: true,
    note: "市场洞察预生成留待 P6 数据应用框架实现（insights.ts 当前为骨架）",
  };
}
