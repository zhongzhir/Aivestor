// src/lib/orgInject.ts —— 机构层 / 中鉴层 prompt 注入（架构文档 v1.1 第 8 部分）
//
// 与 injectProfile 同构：失败静默降级、可空跳过。
// 个人版零影响：无 org / 无能力位 / 无命中时返回原文，prompt 零变化。

import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { hasCapability } from "@/lib/orgAuth";
import type { AccessScope } from "@/lib/resourceAccess";

// 注入预算（8.2）：机构层 5 条上限、单条 300 字符截断。
const ORG_MAX_FRAGMENTS = 5;
const ORG_CHAR_LIMIT = 300;
// 短 query（如「继续」）不触发检索——噪声大、价值低（与 memoryContext 一致）。
const MIN_QUERY_LEN = 10;

interface OrgHit {
  content: string;
  author_name: string | null;
}

// 检索机构沉淀层（visibility='org'）。优先向量；百炼未配置时回退全文检索；
// 任一失败返回空数组，不阻塞主流程。
async function searchOrgKnowledge(
  orgId: string,
  question: string
): Promise<OrgHit[]> {
  const qlen = question?.trim().length ?? 0;
  if (!question || qlen < MIN_QUERY_LEN) {
    // [DIAG] 临时诊断日志（任务完成后移除）
    console.log(
      `[orgInject][diag] query too short (len=${qlen} < ${MIN_QUERY_LEN}), skip retrieval. query="${question}"`
    );
    return [];
  }
  try {
    const emb = await generateEmbedding(question);
    if (emb) {
      // [DIAG] 额外取 id + 相似度用于诊断（注入逻辑只用 content/author_name）
      const rows = await query<
        OrgHit & { id: string; similarity: number }
      >(
        `SELECT kb.id, kb.content, u.name AS author_name,
                1 - (kb.embedding <=> $2::vector) AS similarity
           FROM knowledge_base_entries kb
           LEFT JOIN users u ON u.id = kb.user_id
          WHERE kb.org_id = $1 AND kb.visibility = 'org'
            AND kb.embedding IS NOT NULL
          ORDER BY kb.embedding <=> $2::vector
          LIMIT $3`,
        [orgId, `[${emb.vector.join(",")}]`, ORG_MAX_FRAGMENTS]
      );
      console.log(
        `[orgInject][diag] vector retrieval org=${orgId} candidates=${rows.length} (无相似度阈值，命中即注入)`
      );
      for (const r of rows) {
        console.log(
          `[orgInject][diag]   id=${r.id} sim=${Number(r.similarity).toFixed(4)} content="${r.content.slice(0, 50)}"`
        );
      }
      return rows.map((r) => ({ content: r.content, author_name: r.author_name }));
    }
    // [DIAG] 全文检索兜底（百炼未生成 embedding 时）
    const rows = await query<OrgHit & { id: string }>(
      `SELECT kb.id, kb.content, u.name AS author_name
         FROM knowledge_base_entries kb
         LEFT JOIN users u ON u.id = kb.user_id
        WHERE kb.org_id = $1 AND kb.visibility = 'org'
          AND kb.search_vector @@ plainto_tsquery('simple', $2)
        ORDER BY ts_rank(kb.search_vector, plainto_tsquery('simple', $2)) DESC
        LIMIT $3`,
      [orgId, question, ORG_MAX_FRAGMENTS]
    );
    console.log(
      `[orgInject][diag] FTS fallback (embedding 不可用) org=${orgId} candidates=${rows.length}`
    );
    for (const r of rows) {
      console.log(
        `[orgInject][diag]   id=${r.id} (fts) content="${r.content.slice(0, 50)}"`
      );
    }
    return rows.map((r) => ({ content: r.content, author_name: r.author_name }));
  } catch (e) {
    console.log("[orgInject][diag] retrieval threw, returning []:", e);
    return [];
  }
}

// 机构知识注入：检索机构沉淀层，格式化为 "## 机构知识沉淀" 段。
// 无 org / 无 org_knowledge 能力位 / 无命中 → 返回原文。
export async function injectOrgKnowledge(
  scope: AccessScope,
  question: string,
  originalSystem: string
): Promise<string> {
  try {
    if (!scope.org) {
      console.log("[orgInject][diag] no org on scope → return original");
      return originalSystem;
    }
    const cap = await hasCapability(scope.org.orgId, "org_knowledge");
    console.log(
      `[orgInject][diag] called org=${scope.org.orgId} role=${scope.org.role} org_knowledge=${cap} queryLen=${question?.length ?? 0} query="${question}"`
    );
    if (!cap) {
      console.log("[orgInject][diag] no org_knowledge capability → return original");
      return originalSystem;
    }
    const hits = await searchOrgKnowledge(scope.org.orgId, question);
    if (hits.length === 0) {
      console.log("[orgInject][diag] retrieval empty → no section, return original");
      return originalSystem;
    }

    const lines = hits
      .map((h) => {
        const author = h.author_name?.trim() || "机构成员";
        return `【机构沉淀·${author}】${h.content.slice(0, ORG_CHAR_LIMIT)}`;
      })
      .join("\n\n");

    console.log(
      `[orgInject][diag] section GENERATED, ${hits.length} hits. injected block:\n## 机构知识沉淀\n${lines}`
    );
    return `${originalSystem}\n\n## 机构知识沉淀\n以下是本机构成员沉淀的相关判断与认知，供参考（请结合当前项目实际情况判断其适用性）：\n\n${lines}`;
  } catch (e) {
    console.log("[orgInject][diag] injectOrgKnowledge threw → return original:", e);
    return originalSystem;
  }
}

// 中鉴市场上下文注入：检索 zjjr_features，格式化为
// "## 市场参考数据（中鉴基金研究院）" 段 + 防穷举硬规则（8.3）。
// —— 本期不实现（P6），签名占位。无 zjjr_data 能力位 / 无命中 → 返回原文。
//
// export async function injectMarketContext(
//   scope: AccessScope,
//   question: string,
//   originalSystem: string
// ): Promise<string>;
