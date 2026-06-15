// 同步核心编排：清洗 → 实体解析 → 特征提取 → 自然语言化 → 向量化 → 双轨写入。
// full-sync.ts / incremental-sync.ts / scripts/smoke-test.ts 共用本编排。

import type { PoolClient } from "pg";
import { withTransaction, query } from "./db";
import type {
  ZjjrInstitutionRaw,
  ZjjrInvestmentRaw,
} from "./client";
import { cleanInstitution, cleanInvestment } from "./pipeline/clean";
import { resolveInstitution } from "./pipeline/resolve";
import { extractFeatures } from "./pipeline/extract";
import { narrateAll } from "./pipeline/narrate";
import { embedFeatures } from "./pipeline/embed";
import {
  upsertInstitutions,
  upsertInvestments,
  writeFeatures,
} from "./pipeline/write";

export interface PipelineResult {
  institutions: number;
  investments: number;
  features: number;
  pendingMerges: number;
  embedded: boolean; // 是否成功生成向量（false = 降级为纯文本检索）
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 跑完整流水线（在单事务内：解析→双轨写入；向量化在事务外先算好再传入）。
export async function runPipeline(
  rawInstitutions: ZjjrInstitutionRaw[],
  rawInvestments: ZjjrInvestmentRaw[]
): Promise<PipelineResult> {
  const dataAsOf = today();

  // 1. 清洗（纯函数，事务外）。
  const cleanInsts = rawInstitutions.map(cleanInstitution);
  const cleanInvs = rawInvestments.map(cleanInvestment);

  return withTransaction(async (client: PoolClient) => {
    // 2. 实体解析（读既有行判定 aliases / pending_merge）。
    const resolved = [];
    for (const inst of cleanInsts) {
      resolved.push(await resolveInstitution(client, inst));
    }
    const pendingMerges = resolved.reduce(
      (n, r) => n + r.pendingMerge.length,
      0
    );

    // 3. 结构化轨：机构 + 投资事件 upsert。
    const instIdBySource = await upsertInstitutions(client, resolved);
    const investmentCount = await upsertInvestments(
      client,
      cleanInvs,
      instIdBySource
    );

    // 4. 特征提取（聚合统计）。
    const extracted = extractFeatures({
      institutions: resolved,
      investments: cleanInvs,
      instIdBySource,
      dataAsOf,
    });

    // 5. 自然语言化（模板）。
    const narrated = narrateAll(extracted);

    // 6. 向量化（调百炼；未配 Key 时降级为 null 向量）。
    const embedded = await embedFeatures(narrated);
    const hasEmbedding = embedded.some((f) => f.embedding !== null);

    // 7. 特征轨：受影响实体先删后插。
    const featureCount = await writeFeatures(client, embedded);

    return {
      institutions: instIdBySource.size,
      investments: investmentCount,
      features: featureCount,
      pendingMerges,
      embedded: hasEmbedding,
    };
  });
}

// ---- 同步日志：开/收尾 ----
export async function openSyncLog(
  syncType: "institutions" | "investments" | "full" | "features_rebuild"
): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO zjjr_sync_log (sync_type, status) VALUES ($1, 'running') RETURNING id`,
    [syncType]
  );
  return rows[0].id;
}

export async function closeSyncLog(
  id: string,
  status: "success" | "failed",
  opts: {
    recordsFetched?: number;
    recordsUpserted?: number;
    watermark?: string | null;
    errorDetail?: string | null;
  } = {}
): Promise<void> {
  await query(
    `UPDATE zjjr_sync_log
        SET status = $2, finished_at = now(),
            records_fetched = $3, records_upserted = $4,
            watermark = $5, error_detail = $6
      WHERE id = $1`,
    [
      id,
      status,
      opts.recordsFetched ?? 0,
      opts.recordsUpserted ?? 0,
      opts.watermark ?? null,
      opts.errorDetail ?? null,
    ]
  );
}

// 上次成功同步的水位（增量起点）。无成功记录返回 null（首次走全量）。
export async function lastWatermark(): Promise<string | null> {
  const rows = await query<{ watermark: string | null }>(
    `SELECT watermark FROM zjjr_sync_log
      WHERE status = 'success' AND watermark IS NOT NULL
      ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0]?.watermark ?? null;
}
