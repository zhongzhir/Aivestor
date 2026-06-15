// 增量同步入口（架构文档 v1.1 第 5.2 节）。
//   读上次成功同步的 watermark → fetchUpdates(updated_since=watermark) →
//   双轨 upsert → 触发受影响实体特征重建 → 写新水位。
//   无历史水位（首次运行）时回退为全量拉取（等价 full，但不重建 ivfflat 索引——
//   索引建立由 full-sync 负责）。
//
// PM2 每日 02:30 cron 重拉本进程（见 ecosystem.config.js），同步完即退出。

import { createClient } from "./client";
import { pool } from "./db";
import {
  runPipeline,
  openSyncLog,
  closeSyncLog,
  lastWatermark,
} from "./sync-core";

async function main(): Promise<void> {
  const logId = await openSyncLog("full"); // 增量批次记为 full 类型（含机构+投资两轨）
  try {
    const client = createClient();
    const since = await lastWatermark();

    let institutions;
    let investments;
    if (since) {
      const updates = await client.fetchUpdates({ updatedSince: since });
      institutions = updates.institutions;
      investments = updates.investments;
    } else {
      // 首次：无水位，拉全量（索引建立另由 full-sync 负责）。
      const inst = await client.fetchInstitutions({});
      const inv = await client.fetchInvestments({});
      institutions = inst.items;
      investments = inv.items;
    }

    const result = await runPipeline(institutions, investments);

    await closeSyncLog(logId, "success", {
      recordsFetched: institutions.length + investments.length,
      recordsUpserted: result.institutions + result.investments,
      watermark: new Date().toISOString(),
    });

    console.log(
      `[incremental-sync] 完成（since=${since ?? "全量"}）：` +
        `机构 ${result.institutions} / 投资 ${result.investments} / 特征 ${result.features}` +
        `（向量化 ${result.embedded ? "已生成" : "降级为纯文本"}，pending_merge ${result.pendingMerges}）`
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await closeSyncLog(logId, "failed", { errorDetail: detail });
    console.error("[incremental-sync] 失败:", detail);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
