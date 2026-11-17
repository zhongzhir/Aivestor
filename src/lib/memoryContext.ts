import { query } from "@/lib/db";
import { getUserProfile, formatProfileForPrompt } from "@/lib/user-profile";
import { buildAccessScope } from "@/lib/resourceAccess";
import { searchLayeredKnowledge } from "@/lib/knowledgeSearch";
import type { ConversationSource } from "@/lib/conversationResearch";

// 对话上下文记忆：把投资人画像 + 近期沉淀 + 相关知识库片段
// 三段拼成自然语言注入到 system prompt 头部。

const RECENT_DIGEST_LIMIT = 10;
const KB_TOPK = 5;
const KB_CHAR_LIMIT = 1200;

interface DigestRow {
  content: string;
  created_at: string;
}

async function recentDigests(userId: string, projectId?: string | null): Promise<DigestRow[]> {
  try {
    return await query<DigestRow>(
      `SELECT content, created_at
         FROM knowledge_base_entries
        WHERE user_id = $1 AND entry_type = 'conversation_digest'
          AND ($3::uuid IS NULL OR project_id = $3)
        ORDER BY created_at DESC LIMIT $2`,
      [userId, RECENT_DIGEST_LIMIT, projectId ?? null]
    );
  } catch {
    return [];
  }
}

export interface MemoryContextResult {
  context: string;
  sources: ConversationSource[];
}

export async function buildMemoryContext(
  userId: string,
  userMessage: string,
  projectId?: string | null
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
  const digests = await recentDigests(userId, projectId);
  if (digests.length > 0) {
    const lines = digests.map((d) => `- ${d.content}`).join("\n");
    parts.push(`## 近期讨论摘要（可能含未验证假设，仅作讨论背景，不能作为独立事实证据）\n${lines}`);
  }

  // 3. 与当前消息相关的知识库条目（三层检索；个人版自动退化为现状单层）
  const scope = await buildAccessScope(userId);
  const hits = await searchLayeredKnowledge(scope, userMessage, {
    topKPersonal: KB_TOPK,
    topKOrg: KB_TOPK,
  });
  return {
    context: parts.join("\n\n"),
    sources: hits.slice(0, 8).map((h) => ({
      id: h.id ?? undefined,
      content: h.content.slice(0, KB_CHAR_LIMIT),
      source_type: h.sourceType,
      title: h.title || (h.layer === "zjjr" ? "中鉴数据" : h.layer === "org" ? `机构知识 · ${h.authorName || "机构成员"}` : "个人知识"),
      data_as_of: h.dataAsOf,
    })),
  };
}
