// 市场洞察生成入口（架构文档 v1.1 第 6.2 节）。
//   PM2 第二个 cron 进程每周一 03:30 触发（见 ecosystem.config.js）。
//   聚合上周 zjjr_investments → 调 DeepSeek → upsert market_insights，完即退出。
//
// 前置：迁移 029 已执行；SYSTEM_DEEPSEEK_API_KEY 已配置（未配置则跳过、保留上期）。

import { pool } from "./db";
import { generateMarketInsights } from "./insights";

async function main(): Promise<void> {
  try {
    const result = await generateMarketInsights();
    console.log(
      `[generate-insights] ${result.skipped ? "跳过" : "完成"}：${result.note}`
    );
  } catch (e) {
    console.error(
      "[generate-insights] 失败:",
      e instanceof Error ? e.message : String(e)
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
