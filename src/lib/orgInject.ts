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
// 检索 query 是项目描述符（名称+行业+阶段 / 报告标题等），不是对话消息，
// 不存在「继续」「展开」这类噪声 query；只需排除空/单字符的退化 query。
// 注意：中文项目名常仅 2–4 字（且行业/阶段可能未填），原 10 字门槛会把
// 「大美非遗」「喷空」这类合法短名一并误杀、导致机构知识检索从不触发。
const MIN_QUERY_LEN = 2;

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
  if (!question || question.trim().length < MIN_QUERY_LEN) return [];
  try {
    const emb = await generateEmbedding(question);
    if (emb) {
      return await query<OrgHit>(
        `SELECT kb.content, u.name AS author_name
           FROM knowledge_base_entries kb
           LEFT JOIN users u ON u.id = kb.user_id
          WHERE kb.org_id = $1 AND kb.visibility = 'org'
            AND kb.embedding IS NOT NULL
          ORDER BY kb.embedding <=> $2::vector
          LIMIT $3`,
        [orgId, `[${emb.vector.join(",")}]`, ORG_MAX_FRAGMENTS]
      );
    }
    return await query<OrgHit>(
      `SELECT kb.content, u.name AS author_name
         FROM knowledge_base_entries kb
         LEFT JOIN users u ON u.id = kb.user_id
        WHERE kb.org_id = $1 AND kb.visibility = 'org'
          AND kb.search_vector @@ plainto_tsquery('simple', $2)
        ORDER BY ts_rank(kb.search_vector, plainto_tsquery('simple', $2)) DESC
        LIMIT $3`,
      [orgId, question, ORG_MAX_FRAGMENTS]
    );
  } catch {
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
    if (!scope.org) return originalSystem;
    if (!(await hasCapability(scope.org.orgId, "org_knowledge"))) {
      return originalSystem;
    }
    const hits = await searchOrgKnowledge(scope.org.orgId, question);
    if (hits.length === 0) return originalSystem;

    const lines = hits
      .map((h) => {
        const author = h.author_name?.trim() || "机构成员";
        return `【机构沉淀·${author}】${h.content.slice(0, ORG_CHAR_LIMIT)}`;
      })
      .join("\n\n");

    return `${originalSystem}\n\n## 机构知识沉淀\n以下是本机构成员沉淀的相关判断与认知，供参考（请结合当前项目实际情况判断其适用性）：\n\n${lines}`;
  } catch {
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
