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
  id: string | null; // kb.id（zjjr 层为 null）；用于同源对去重
  sourceEntryId: string | null; // 机构层副本指向的个人层原记录 id；其余 null
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
  id?: string | null;
  source_entry_id?: string | null;
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
        `SELECT id, source_entry_id, content, source_type,
                1 - (embedding <=> $2::vector) AS similarity
           FROM knowledge_base_entries
          WHERE user_id = $1 AND visibility = 'private' AND embedding IS NOT NULL
          ORDER BY embedding <=> $2::vector
          LIMIT $3`,
        [userId, vec, topK]
      );
    } else {
      rows = await query<RawHit>(
        `SELECT id, source_entry_id, content, source_type,
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
        `SELECT kb.id, kb.source_entry_id, kb.content, kb.source_type, u.name AS author_name,
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
        `SELECT kb.id, kb.source_entry_id, kb.content, kb.source_type, u.name AS author_name,
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

// 中鉴层检索（架构文档 v1.1 第 3.3 / 5.5 节，P5 接通）。
//   - 仅向量检索（zjjr 层无全文兜底，vec 为空时由调用方跳过本路）。
//   - 过期降权不剔除：valid_until 未过期 freshness=1.0，过期=0.5（5.5）。
//   - 来源标注：特征正文在生成时已内置「来源：中鉴基金研究院，数据截止…，仅供参考」
//     （services/zjjr-sync narrate.ts）；此处兜底确保标注存在。
//   - 静默降级：表为空 / 查询异常（如迁移 028 未执行）→ 返回 []，不阻塞主流程。
interface ZjjrRawHit {
  title: string | null;
  content: string;
  data_as_of: string | null;
  valid_until: string | null;
  similarity: number;
  fresh: boolean;
}

const ZJJR_SOURCE_TAG = "中鉴基金研究院";

async function searchZjjr(vec: string, topK: number): Promise<LayeredHit[]> {
  try {
    const rows = await query<ZjjrRawHit>(
      `SELECT title, content,
              data_as_of::text  AS data_as_of,
              valid_until::text AS valid_until,
              1 - (embedding <=> $1::vector) AS similarity,
              (valid_until > NOW()) AS fresh
         FROM zjjr_features
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [vec, topK]
    );
    return rows.map((r) => {
      const similarity = Number(r.similarity) || 0;
      const freshness = r.fresh ? 1.0 : 0.5; // 过期降权不剔除（5.5）
      const content = r.content.includes(ZJJR_SOURCE_TAG)
        ? r.content
        : `${r.content}（来源：${ZJJR_SOURCE_TAG}，数据截止 ${r.data_as_of ?? "未知"}，仅供参考）`;
      return {
        layer: "zjjr" as const,
        id: null,
        sourceEntryId: null,
        content,
        sourceType: "zjjr_feature",
        title: r.title,
        authorName: null,
        validUntil: r.valid_until,
        similarity,
        weighted: similarity * LAYER_WEIGHT.zjjr * freshness,
      };
    });
  } catch {
    // 迁移 028 未执行 / 无 zjjr 数据 / 主应用账号无 SELECT 权限 → 静默空数组。
    return [];
  }
}

function toHit(layer: KnowledgeLayer, r: RawHit): LayeredHit {
  const similarity = Number(r.similarity) || 0;
  return {
    layer,
    id: r.id ?? null,
    sourceEntryId: r.source_entry_id ?? null,
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
  const topKZjjr = opts?.topKZjjr ?? 5;

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
  // 中鉴层是否参与：有 org、开通 zjjr_data 能力位，且本次有可用向量
  //   （zjjr 层无全文兜底，vec 为空直接跳过）。
  let zjjrParticipates = false;
  if (scope.org) {
    try {
      orgParticipates = await hasCapability(scope.org.orgId, "org_knowledge");
    } catch {
      orgParticipates = false;
    }
    if (vec) {
      try {
        zjjrParticipates = await hasCapability(scope.org.orgId, "zjjr_data");
      } catch {
        zjjrParticipates = false;
      }
    }
  }

  // 三路并发；任一路失败返回空不阻塞。
  const [personal, org, zjjr] = await Promise.all([
    searchPersonal(scope.userId, question, vec, topKPersonal),
    orgParticipates && scope.org
      ? searchOrg(scope.org.orgId, question, vec, topKOrg)
      : Promise.resolve<LayeredHit[]>([]),
    zjjrParticipates && vec
      ? searchZjjr(vec, topKZjjr)
      : Promise.resolve<LayeredHit[]>([]),
  ]);

  // 同源对去重：晋升为复制后，个人层原记录与机构层副本内容相同。
  // 若某条机构层结果的 sourceEntryId 命中某条个人层结果的 id，丢弃个人层那条，
  // 只保留机构层副本（带作者标识），避免同一内容注入两次。
  // 非同源命中（个人独有 / 他人晋升的机构条目）不受影响。
  const promotedSourceIds = new Set(
    org.map((h) => h.sourceEntryId).filter((x): x is string => !!x)
  );
  const dedupedPersonal = personal.filter(
    (h) => !(h.id && promotedSourceIds.has(h.id))
  );

  return [...dedupedPersonal, ...org, ...zjjr].sort(
    (a, b) => b.weighted - a.weighted
  );
}
