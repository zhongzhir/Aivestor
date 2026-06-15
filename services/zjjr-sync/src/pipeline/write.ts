// 双轨写入（架构文档 v1.1 第 5.4 阶段 6）。
//   结构化轨：institutions / investments upsert（ON CONFLICT source_id DO UPDATE）。
//   特征轨  ：features 受影响实体【先删后插】，保证特征与统计一致。

import type { PoolClient } from "pg";
import type {
  CleanInvestment,
  EmbeddedFeature,
  ResolvedInstitution,
} from "../types";

function vecLiteral(v: number[] | null): string | null {
  return v ? `[${v.join(",")}]` : null;
}

// ---- 结构化轨：机构 upsert，返回 sourceId → id 映射 ----
export async function upsertInstitutions(
  client: PoolClient,
  institutions: ResolvedInstitution[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const inst of institutions) {
    // pending_merge 复核标记（pg_trgm 候选）；无候选时为空对象。
    const metadata = JSON.stringify(
      inst.pendingMerge.length > 0 ? { pending_merge: inst.pendingMerge } : {}
    );
    const res = await client.query<{ id: string }>(
      `INSERT INTO zjjr_institutions
         (source_id, name, canonical_name, aliases, institution_type, fund_count,
          manage_scale, focus_sectors, focus_stages, region, reg_status, raw,
          source_updated_at, metadata)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14::jsonb)
       ON CONFLICT (source_id) DO UPDATE SET
         name = EXCLUDED.name,
         canonical_name = EXCLUDED.canonical_name,
         aliases = EXCLUDED.aliases,
         institution_type = EXCLUDED.institution_type,
         fund_count = EXCLUDED.fund_count,
         manage_scale = EXCLUDED.manage_scale,
         focus_sectors = EXCLUDED.focus_sectors,
         focus_stages = EXCLUDED.focus_stages,
         region = EXCLUDED.region,
         reg_status = EXCLUDED.reg_status,
         raw = EXCLUDED.raw,
         source_updated_at = EXCLUDED.source_updated_at,
         -- pending_merge 复核标记并入既有 metadata（不覆盖人工已处理的其他键）
         metadata = zjjr_institutions.metadata || EXCLUDED.metadata
       RETURNING id`,
      [
        inst.sourceId,
        inst.name,
        inst.canonicalName,
        JSON.stringify(inst.aliases),
        inst.institutionType,
        inst.fundCount,
        inst.manageScale,
        JSON.stringify(inst.focusSectors),
        JSON.stringify(inst.focusStages),
        inst.region,
        inst.regStatus,
        JSON.stringify(inst.raw),
        inst.sourceUpdatedAt,
        metadata,
      ]
    );
    map.set(inst.sourceId, res.rows[0].id);
  }
  return map;
}

// ---- 结构化轨：投资事件 upsert（机构未解析到 id 的事件跳过，避免外键悬挂）----
export async function upsertInvestments(
  client: PoolClient,
  investments: CleanInvestment[],
  instIdBySource: Map<string, string>
): Promise<number> {
  let count = 0;
  for (const inv of investments) {
    const institutionId = instIdBySource.get(inv.institutionSourceId);
    if (!institutionId) continue; // 机构缺失：跳过（增量时该机构可能尚未同步）
    await client.query(
      `INSERT INTO zjjr_investments
         (source_id, institution_id, target_company, sector, stage, amount_text,
          invested_at, co_investors, raw, source_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
       ON CONFLICT (source_id) DO UPDATE SET
         institution_id = EXCLUDED.institution_id,
         target_company = EXCLUDED.target_company,
         sector = EXCLUDED.sector,
         stage = EXCLUDED.stage,
         amount_text = EXCLUDED.amount_text,
         invested_at = EXCLUDED.invested_at,
         co_investors = EXCLUDED.co_investors,
         raw = EXCLUDED.raw,
         source_updated_at = EXCLUDED.source_updated_at`,
      [
        inv.sourceId,
        institutionId,
        inv.targetCompany,
        inv.sector,
        inv.stage,
        inv.amountText,
        inv.investedAt,
        JSON.stringify(inv.coInvestors),
        JSON.stringify(inv.raw),
        inv.sourceUpdatedAt,
      ]
    );
    count += 1;
  }
  return count;
}

// ---- 特征轨：受影响实体先删后插 ----
export async function writeFeatures(
  client: PoolClient,
  features: EmbeddedFeature[]
): Promise<number> {
  // 受影响范围：机构维度（institution_id 非空）+ 赛道维度（sector_trend，institution_id 空）。
  const instIds = Array.from(
    new Set(
      features
        .map((f) => f.institutionId)
        .filter((x): x is string => !!x)
    )
  );
  const sectors = Array.from(
    new Set(
      features
        .filter((f) => f.featureKind === "sector_trend" && f.sector)
        .map((f) => f.sector as string)
    )
  );

  if (instIds.length > 0) {
    await client.query(
      `DELETE FROM zjjr_features WHERE institution_id = ANY($1::uuid[])`,
      [instIds]
    );
  }
  if (sectors.length > 0) {
    await client.query(
      `DELETE FROM zjjr_features
         WHERE institution_id IS NULL AND sector = ANY($1::text[])`,
      [sectors]
    );
  }

  let count = 0;
  for (const f of features) {
    await client.query(
      `INSERT INTO zjjr_features
         (feature_kind, institution_id, sector, title, content, embedding,
          data_as_of, valid_until, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9::jsonb)`,
      [
        f.featureKind,
        f.institutionId,
        f.sector,
        f.title,
        f.content,
        vecLiteral(f.embedding),
        f.dataAsOf,
        f.validUntil,
        JSON.stringify(f.stats ?? {}),
      ]
    );
    count += 1;
  }
  return count;
}

// ---- ivfflat 索引：首次全量导入完成后创建（迁移 028 刻意不建，原因见该迁移注释）----
// 该索引存在则跳过；日常增量写入由索引自动维护。features_rebuild 大批量重灌后另需
// REINDEX 重算聚类中心（见架构文档 5.2）。
export async function ensureEmbeddingIndex(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_zjjr_features_embedding ON zjjr_features
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
  );
}
