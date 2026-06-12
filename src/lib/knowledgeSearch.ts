// src/lib/knowledgeSearch.ts —— 三层语义检索统一入口（架构文档 v1.1 第 3.3 节）
//
// 三层：个人判断层（personal）/ 机构沉淀层（org）/ 中鉴公共层（zjjr）。
// 本期 zjjr 路留空返回 []，函数结构与 LayeredHit 类型完整保留（P6 接入）。
//
// 个人版零影响：scope.org === null 时仅个人层参与，退化为现状单层检索。

import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { hasCapability } from "@/lib/orgAuth";
import type { AccessScope } from "@/lib/resourceAccess";

export type KnowledgeLayer = "personal" | "org" | "zjjr";

export interface LayeredHit {
  layer: KnowledgeLayer;
  content: string;
  sourceType: string | null; // 个人/机构层：kb.source_type；zjjr 层固定 "zjjr_feature"
  title: string | null;
  authorName: string | null; // 机构层条目作者；其余 null
  validUntil: string | null; // 仅 zjjr 层
  similarity: number; // 1 - 余弦距离（或全文 rank）
  weighted: number; // similarity × 层权重 × 时效系数（排序依据）
}

export interface LayeredSearchOptions {
  topKPersonal?: number; // 默认 5
  topKOrg?: number; // 默认 5
  topKZjjr?: number; // 默认 5
}

// 层权重：个人判断是产品核心价值，优先呈现。
const LAYER_WEIGHT: Record<KnowledgeLayer, number> = {
  personal: 1.0,
  org: 0.95,
  zjjr: 0.85,
};

const MIN_QUERY_LEN = 10;

interface RawHit {
  content: string;
  source_type: string | null;
  author_name?: string | null;
  similarity: number;
}

// 个人层检索：visibility='private'（存量个人条目默认 private，行为不变）。
async function searchPersonal(
  userId: string,
  question: string,
  vec: string | null,
  topK: number
): Promise<LayeredHit[]> {
  try {
    let rows: RawHit[];
    if (vec) {
      rows = await query<RawHit>(
        `SELECT content, source_type, 1 - (embedding <=> $2::vector) AS similarity
           FROM knowledge_base_entries
          WHERE user_id = $1 AND visibility = 'private' AND embedding IS NOT NULL
          ORDER BY embedding <=> $2::vector
          LIMIT $3`,
        [userId, vec, topK]
      );
    } else {
      rows = await query<RawHit>(
        `SELECT content, source_type,
                ts_rank(search_vector, plainto_tsquery('simple', $2)) AS similarity
           FROM knowledge_base_entries
          WHERE user_id = $1 AND visibility = 'private'
            AND search_vector @@ plainto_tsquery('simple', $2)
          ORDER BY similarity DESC
          LIMIT $3`,
        [userId, question, topK]
      );
    }
    return rows.map((r) => toHit("personal", r));
  } catch {
    return [];
  }
}

// 机构层检索：visibility='org'，带作者名。
async function searchOrg(
  orgId: string,
  question: string,
  vec: string | null,
  topK: number
): Promise<LayeredHit[]> {
  try {
    let rows: RawHit[];
    if (vec) {
      rows = await query<RawHit>(
        `SELECT kb.content, kb.source_type, u.name AS author_name,
                1 - (kb.embedding <=> $2::vector) AS similarity
           FROM knowledge_base_entries kb
           LEFT JOIN users u ON u.id = kb.user_id
          WHERE kb.org_id = $1 AND kb.visibility = 'org' AND kb.embedding IS NOT NULL
          ORDER BY kb.embedding <=> $2::vector
          LIMIT $3`,
        [orgId, vec, topK]
      );
    } else {
      rows = await query<RawHit>(
        `SELECT kb.content, kb.source_type, u.name AS author_name,
                ts_rank(kb.search_vector, plainto_tsquery('simple', $2)) AS similarity
           FROM knowledge_base_entries kb
           LEFT JOIN users u ON u.id = kb.user_id
          WHERE kb.org_id = $1 AND kb.visibility = 'org'
            AND kb.search_vector @@ plainto_tsquery('simple', $2)
          ORDER BY similarity DESC
          LIMIT $3`,
        [orgId, question, topK]
      );
    }
    return rows.map((r) => toHit("org", r));
  } catch {
    return [];
  }
}

// 中鉴层检索：本期留空（P6 接入 zjjr_features）。
async function searchZjjr(): Promise<LayeredHit[]> {
  return [];
}

function toHit(layer: KnowledgeLayer, r: RawHit): LayeredHit {
  const similarity = Number(r.similarity) || 0;
  return {
    layer,
    content: r.content,
    sourceType: r.source_type ?? null,
    title: null,
    authorName: r.author_name ?? null,
    validUntil: null,
    similarity,
    weighted: similarity * LAYER_WEIGHT[layer],
  };
}

export async function searchLayeredKnowledge(
  scope: AccessScope,
  question: string,
  opts?: LayeredSearchOptions
): Promise<LayeredHit[]> {
  if (!question || question.trim().length < MIN_QUERY_LEN) return [];

  const topKPersonal = opts?.topKPersonal ?? 5;
  const topKOrg = opts?.topKOrg ?? 5;

  // 一次 embedding（不可用时全路回退全文检索）
  let vec: string | null = null;
  try {
    const emb = await generateEmbedding(question);
    if (emb) vec = `[${emb.vector.join(",")}]`;
  } catch {
    vec = null;
  }

  // 机构层是否参与：有 org 且开通 org_knowledge 能力位。
  let orgParticipates = false;
  if (scope.org) {
    try {
      orgParticipates = await hasCapability(scope.org.orgId, "org_knowledge");
    } catch {
      orgParticipates = false;
    }
  }

  // 三路并发；任一路失败返回空不阻塞。
  const [personal, org, zjjr] = await Promise.all([
    searchPersonal(scope.userId, question, vec, topKPersonal),
    orgParticipates && scope.org
      ? searchOrg(scope.org.orgId, question, vec, topKOrg)
      : Promise.resolve<LayeredHit[]>([]),
    searchZjjr(),
  ]);

  return [...personal, ...org, ...zjjr].sort((a, b) => b.weighted - a.weighted);
}
