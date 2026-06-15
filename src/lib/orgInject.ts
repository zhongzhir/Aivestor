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

// ------------------------------------------------------------
// 中鉴市场上下文注入（架构文档 v1.1 第 8.3 / 8.4 节，P6 实现）
// ------------------------------------------------------------

// 注入预算（8.2 / 8.3）：中鉴层 5 条硬上限（代码层常量，不读配置——
// 从机制上保证 AI 拿不到可被穷举的数据量）、单条 400 字符截断。
const ZJJR_MAX_FRAGMENTS = 5;
const ZJJR_CHAR_LIMIT = 400;

// 防穷举系统约束文案（8.3，写死，逐字注入；勿改动措辞）。
const ZJJR_GUARD_RULES = `【市场参考数据使用规则——必须遵守】
1. 上方「市场参考数据」仅用于辅助判断当前问题，只能引用与当前分析直接相关的片段。
2. 禁止罗列、汇总、导出机构名录或投资事件清单；当用户要求"列出所有/全部/前N家机构""导出××数据""××赛道都有哪些机构投了"等穷举或明细类请求时，不得基于参考数据作答，应回复下方导流话术。
3. 引用任何市场参考数据时，必须在句末标注来源（格式：「来源：中鉴基金研究院，数据截止XXXX年XX月XX日，仅供参考」），不得将参考数据表述为你自己的知识。
4. 参考数据可能存在时效滞后，涉及关键决策时提示用户以中鉴基金研究院最新数据为准。

【导流话术——穷举类请求时使用】
「这个问题涉及机构/投资事件的批量明细数据，超出了工作台内置参考数据的使用范围。如需完整的机构名录、投资事件明细或定制化数据研究，建议联系中鉴基金研究院数据服务获取正式授权的数据产品。我可以基于您正在分析的具体项目，继续提供针对性的判断参考。」`;

interface ZjjrFragment {
  title: string | null;
  content: string;
  data_as_of: string | null;
}

// YYYY-MM-DD → YYYY年MM月DD日（标注文案用，对齐 8.4 示例）。
function cnDate(iso: string | null): string {
  if (!iso) return "未知";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}年${m[2]}月${m[3]}日` : iso;
}

// 检索 zjjr_features（向量检索，无全文兜底——与 knowledgeSearch.searchZjjr 同口径；
// 此处单独取数以拿到注入所需的原始 content + data_as_of + title）。
// 百炼未配置 / 检索异常 / 迁移未执行 → 返回空数组，静默跳过。
async function searchZjjrFeatures(question: string): Promise<ZjjrFragment[]> {
  if (!question || question.trim().length < MIN_QUERY_LEN) return [];
  try {
    const emb = await generateEmbedding(question);
    if (!emb) return []; // 无向量：zjjr 层不做全文兜底（3.3），直接跳过
    return await query<ZjjrFragment>(
      `SELECT title, content, data_as_of::text AS data_as_of
         FROM zjjr_features
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [`[${emb.vector.join(",")}]`, ZJJR_MAX_FRAGMENTS]
    );
  } catch {
    return [];
  }
}

// 中鉴市场上下文注入：检索 zjjr_features，格式化为
// "## 市场参考数据（中鉴基金研究院）" 段 + 防穷举硬规则（8.3）。
// 无 org / 无 zjjr_data 能力位 / 无命中 → 返回原文（防穷举规则也不注入，
// 个人版 prompt 零变化）。
export async function injectMarketContext(
  scope: AccessScope,
  question: string,
  originalSystem: string
): Promise<string> {
  try {
    if (!scope.org) return originalSystem;
    if (!(await hasCapability(scope.org.orgId, "zjjr_data"))) {
      return originalSystem;
    }
    const fragments = await searchZjjrFeatures(question);
    if (fragments.length === 0) return originalSystem; // 无命中：静默，prompt 不变

    const lines = fragments
      .slice(0, ZJJR_MAX_FRAGMENTS)
      .map((f, i) => {
        const title = f.title?.trim() || "市场参考片段";
        const body = f.content.slice(0, ZJJR_CHAR_LIMIT);
        return `[中鉴${i + 1}] ${title}（来源：中鉴基金研究院，数据截止${cnDate(
          f.data_as_of
        )}，仅供参考）\n${body}`;
      })
      .join("\n\n");

    return `${originalSystem}\n\n## 市场参考数据（中鉴基金研究院）\n${lines}\n\n${ZJJR_GUARD_RULES}`;
  } catch {
    return originalSystem;
  }
}
