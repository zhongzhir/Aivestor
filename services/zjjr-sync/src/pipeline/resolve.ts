// 实体解析 / 机构名消歧（架构文档 v1.1 第 5.4 阶段 2）。
//
// 三级匹配策略：
//   ① source_id 精确命中（同源更新）—— 复用既有行 id。
//   ② canonical_name 精确匹配（去除「（有限合伙）/ 管理有限公司」等后缀后比对）——
//      视为同一机构的高置信线索：累积别名（aliases），但仍按 source_id 各自成行。
//   ③ pg_trgm 相似度 > 0.85 的候选【进人工复核队列】（写 metadata.pending_merge），
//      【不自动合并】—— 机构名误合并的代价远高于重复。
//
// 本模块只读既有行做判定，不写库；写入由 write.ts 负责。

import type { PoolClient } from "pg";
import type { CleanInstitution, ResolvedInstitution } from "../types";

const TRGM_THRESHOLD = 0.85;

interface ExistingRow {
  id: string;
  source_id: string;
  name: string;
  canonical_name: string;
  aliases: string[];
  similarity?: number;
}

export async function resolveInstitution(
  client: PoolClient,
  inst: CleanInstitution
): Promise<ResolvedInstitution> {
  // ① source_id 精确命中（同源更新）。
  const bySource = await client.query<ExistingRow>(
    `SELECT id, source_id, name, canonical_name, aliases
       FROM zjjr_institutions WHERE source_id = $1 LIMIT 1`,
    [inst.sourceId]
  );

  const aliases = new Set<string>();
  if (inst.name) aliases.add(inst.name);

  let id = "";
  if (bySource.rows[0]) {
    id = bySource.rows[0].id;
    for (const a of bySource.rows[0].aliases ?? []) aliases.add(a);
  }

  // ② canonical_name 精确匹配（排除自身 source_id）：高置信同机构，累积别名。
  const byCanonical = await client.query<ExistingRow>(
    `SELECT id, source_id, name, canonical_name, aliases
       FROM zjjr_institutions
      WHERE canonical_name = $1 AND source_id <> $2`,
    [inst.canonicalName, inst.sourceId]
  );
  for (const row of byCanonical.rows) {
    if (row.name) aliases.add(row.name);
    for (const a of row.aliases ?? []) aliases.add(a);
  }

  // ③ pg_trgm 相似度 > 0.85 候选（排除自身与已被②命中的精确同名）：进 pending_merge。
  const canonicalExactIds = new Set(byCanonical.rows.map((r) => r.id));
  const bySimilar = await client.query<ExistingRow>(
    `SELECT id, source_id, name, canonical_name, aliases,
            similarity(name, $1) AS similarity
       FROM zjjr_institutions
      WHERE source_id <> $2
        AND similarity(name, $1) > $3
      ORDER BY similarity DESC
      LIMIT 5`,
    [inst.name, inst.sourceId, TRGM_THRESHOLD]
  );

  const pendingMerge = bySimilar.rows
    .filter((r) => !canonicalExactIds.has(r.id))
    .map((r) => ({
      candidateId: r.id,
      similarity: Number(r.similarity) || 0,
    }));

  return {
    ...inst,
    id,
    aliases: Array.from(aliases),
    pendingMerge,
  };
}
