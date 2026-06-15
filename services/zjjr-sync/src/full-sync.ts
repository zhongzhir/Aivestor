// 全量初始化入口（架构文档 v1.1 第 5.2 节）。
//   首次全量导入：拉取全部机构 + 投资事件，跑完整流水线，写入双轨，
//   完成后创建 ivfflat 索引（首次全量后才建，原因见迁移 028 注释）。
//
// 运行：ZJJR_CLIENT=fixture ts-node src/full-sync.ts
//   （接入真实 API 后置 ZJJR_CLIENT=http；需先确认架构文档 5.3 待确认清单 7 项）

import { createClient, type ZjjrInstitutionRaw, type ZjjrInvestmentRaw } from "./client";
import { pool } from "./db";
import {
  runPipeline,
  openSyncLog,
  closeSyncLog,
} from "./sync-core";
import { ensureEmbeddingIndex } from "./pipeline/write";

async function fetchAll(): Promise<{
  institutions: ZjjrInstitutionRaw[];
  investments: ZjjrInvestmentRaw[];
}> {
  const client = createClient();
  const institutions: ZjjrInstitutionRaw[] = [];
  const investments: ZjjrInvestmentRaw[] = [];

  let cursor: string | undefined;
  do {
    const page = await client.fetchInstitutions({ cursor });
    institutions.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  cursor = undefined;
  do {
    const page = await client.fetchInvestments({ cursor });
    investments.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return { institutions, investments };
}

async function main(): Promise<void> {
  const logId = await openSyncLog("full");
  try {
    const { institutions, investments } = await fetchAll();
    const result = await runPipeline(institutions, investments);

    // 首次全量后创建 ivfflat 索引（幂等：已存在则跳过；非事务内 DDL）。
    const idxClient = await pool.connect();
    try {
      await ensureEmbeddingIndex(idxClient);
    } finally {
      idxClient.release();
    }

    await closeSyncLog(logId, "success", {
      recordsFetched: institutions.length + investments.length,
      recordsUpserted: result.institutions + result.investments,
      watermark: new Date().toISOString(),
    });

    console.log(
      `[full-sync] 完成：机构 ${result.institutions} / 投资 ${result.investments} / ` +
        `特征 ${result.features}（向量化 ${result.embedded ? "已生成" : "降级为纯文本"}，` +
        `pending_merge ${result.pendingMerges}）`
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await closeSyncLog(logId, "failed", { errorDetail: detail });
    console.error("[full-sync] 失败:", detail);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
