import { query } from "@/lib/db";
import { getUserProfile, formatProfileForPrompt } from "@/lib/user-profile";
import { buildAccessScope } from "@/lib/resourceAccess";
import { searchLayeredKnowledge } from "@/lib/knowledgeSearch";

// 对话上下文记忆：把投资人画像 + 近期沉淀 + 相关知识库片段
// 三段拼成自然语言注入到 system prompt 头部。

const RECENT_DIGEST_LIMIT = 10;
const KB_TOPK = 5;
const KB_CHAR_LIMIT = 200;

interface DigestRow {
  content: string;
  created_at: string;
}

interface KBHit {
  content: string;
  source_type: string | null;
}

async function recentDigests(userId: string): Promise<DigestRow[]> {
  try {
    return await query<DigestRow>(
      `SELECT content, created_at
         FROM knowledge_base_entries
        WHERE user_id = $1 AND entry_type = 'conversation_digest'
        ORDER BY created_at DESC LIMIT $2`,
      [userId, RECENT_DIGEST_LIMIT]
    );
  } catch {
    return [];
  }
}

export interface MemoryContextResult {
  context: string;
  sources: KBHit[]; // 给前端展示的检索来源
}

export async function buildMemoryContext(
  userId: string,
  userMessage: string
): Promise<MemoryContextResult> {
  const parts: string[] = [];

  // 1. 投资人画像
  try {
    const profile = await getUserProfile(userId);
    if (profile) {
      const section = formatProfileForPrompt(profile);
      if (section) parts.push(section);
    }
  } catch {
    // 画像查询失败静默忽略
  }

  // 2. 近期对话沉淀
  const digests = await recentDigests(userId);
  if (digests.length > 0) {
    const lines = digests.map((d) => `- ${d.content}`).join("\n");
    parts.push(`## 近期认知沉淀\n${lines}`);
  }

  // 3. 与当前消息相关的知识库条目（三层检索；个人版自动退化为现状单层）
  const scope = await buildAccessScope(userId);
  const hits = await searchLayeredKnowledge(scope, userMessage, {
    topKPersonal: KB_TOPK,
    topKOrg: KB_TOPK,
  });
  if (hits.length > 0) {
    const lines = hits
      .map((h, i) => {
        const prefix =
          h.layer === "org"
            ? `【机构沉淀·${h.authorName ?? "机构成员"}】`
            : `(来源: ${h.sourceType ?? "未知"})`;
        return `[${i + 1}] ${prefix} ${h.content.slice(0, KB_CHAR_LIMIT)}`;
      })
      .join("\n\n");
    parts.push(`## 相关知识库条目\n${lines}`);
  }

  return {
    context: parts.join("\n\n"),
    sources: hits.map((h) => ({ content: h.content, source_type: h.sourceType })),
  };
}
