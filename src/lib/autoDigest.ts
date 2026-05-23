import { query } from "@/lib/db";
import { streamChat, type AIProvider } from "@/lib/ai";
import { injectProfile } from "@/lib/user-profile";
import { generateEmbedding } from "@/lib/embedding";

// 服务端自动沉淀：达到触发条件时，把对话提炼为结构化摘要并写入知识库。
// 与 /api/conversations/[id]/digest 的逻辑一致，但跳过用户确认环节。

// 触发条件：消息条数 >= 起步阈值，且每 N 条触发一次。
// 静默化后阈值提高到 10：对话达到 10 条消息时首次后台沉淀，之后每 10 条刷新一次。
export const AUTO_DIGEST_MIN_MESSAGES = 10;
export const AUTO_DIGEST_INTERVAL = 10;

export function shouldAutoDigest(messageCount: number): boolean {
  return (
    messageCount >= AUTO_DIGEST_MIN_MESSAGES &&
    messageCount % AUTO_DIGEST_INTERVAL === 0
  );
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface DigestStructured {
  key_insights: string[];
  open_questions: string[];
  mindset_shift: string | null;
  watch_points: string[];
  summary: string;
}

const DIGEST_SYSTEM =
  "你是一位投资研究助手，擅长从投资分析对话中提炼有价值的认知。";

function formatHistory(messages: Msg[]): string {
  return messages
    .map((m) => `【${m.role === "user" ? "投资人" : "AI"}】${m.content}`)
    .join("\n\n");
}

function buildDigestPrompt(title: string, conversation: string): string {
  return `以下是一段投资人与 AI 的独立对话${title ? `（标题：「${title}」）` : ""}。

请提炼对话中的认知价值，重点提炼投资人的思考。

以 JSON 格式输出，不要输出任何其他内容：
{
  "key_insights": ["最重要的判断或认知，3条以内，每条不超过50字"],
  "open_questions": ["对话结束后仍未解答的核心疑问，2条以内"],
  "mindset_shift": "与对话开始相比认知发生的变化。若无明显变化填null",
  "watch_points": ["后续需要重点核实的事项，2条以内"],
  "summary": "对话核心的100字以内摘要，第一人称，代表投资人视角"
}

如果对话内容过于零散、无实质性判断价值，请返回：{"skip": true, "reason": "原因"}

对话记录：
${conversation}`;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("未找到 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

interface RunOpts {
  conversationId: string;
  userId: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  messages: Msg[];
  provider: AIProvider;
  apiKey: string;
  baseURL?: string;
  freeQuotaMeta?: {
    userId: string;
    feature: string;
  };
}

// 同步执行（serverless 下不要 fire-and-forget；调用方决定是否阻塞）
export async function runAutoDigest(opts: RunOpts): Promise<{
  saved: boolean;
  skipped?: boolean;
  reason?: string;
}> {
  // 防重：如果该对话最近 30 秒内已被自动沉淀过，直接跳过
  try {
    const recent = await query<{ id: string }>(
      `SELECT id FROM knowledge_base_entries
        WHERE user_id = $1
          AND entry_type = 'conversation_digest'
          AND metadata->>'source_conversation_id' = $2
          AND created_at > NOW() - INTERVAL '30 seconds'
        LIMIT 1`,
      [opts.userId, opts.conversationId]
    );
    if (recent.length > 0) return { saved: false, skipped: true, reason: "刚已沉淀" };
  } catch {
    // 防重查询失败不阻断主流程
  }

  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: opts.provider,
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      freeQuotaMeta: opts.freeQuotaMeta,
      system: await injectProfile(opts.userId, DIGEST_SYSTEM),
      messages: [
        {
          role: "user",
          content: buildDigestPrompt(
            opts.title ?? "",
            formatHistory(opts.messages)
          ),
        },
      ],
    })) {
      raw += chunk;
    }
  } catch (e) {
    console.error("[autoDigest] AI 调用失败:", e);
    return { saved: false, skipped: true, reason: "AI 失败" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(raw) as Record<string, unknown>;
  } catch (e) {
    console.error("[autoDigest] JSON 解析失败:", e);
    return { saved: false, skipped: true, reason: "JSON 解析失败" };
  }

  if (parsed.skip) {
    return {
      saved: false,
      skipped: true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "信息量不足",
    };
  }

  const structured: DigestStructured = {
    key_insights: Array.isArray(parsed.key_insights)
      ? parsed.key_insights.filter(
          (x: unknown): x is string => typeof x === "string" && x.trim() !== ""
        )
      : [],
    open_questions: Array.isArray(parsed.open_questions)
      ? parsed.open_questions.filter(
          (x: unknown): x is string => typeof x === "string" && x.trim() !== ""
        )
      : [],
    mindset_shift:
      typeof parsed.mindset_shift === "string" && parsed.mindset_shift.trim()
        ? (parsed.mindset_shift as string)
        : null,
    watch_points: Array.isArray(parsed.watch_points)
      ? parsed.watch_points.filter(
          (x: unknown): x is string => typeof x === "string" && x.trim() !== ""
        )
      : [],
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary.trim()
        : "",
  };

  if (!structured.summary) {
    return { saved: false, skipped: true, reason: "无摘要" };
  }

  // 向量化（百炼未配置或失败则保留纯文本检索，不阻断写入）
  let emb: Awaited<ReturnType<typeof generateEmbedding>> = null;
  try {
    emb = await generateEmbedding(structured.summary);
  } catch (e) {
    console.warn("[autoDigest] embedding 失败，降级为纯文本入库:", e);
  }
  const embeddingModel = emb?.model ?? null;
  const embeddingValue = emb ? `[${emb.vector.join(",")}]` : null;

  const projectName = opts.projectName?.trim() || opts.title || "独立对话";
  const tags = ["对话提炼", projectName, "自动"];
  const metadata: Record<string, unknown> = {
    source_conversation_id: opts.conversationId,
    conversation_title: opts.title ?? "",
    digested_at: new Date().toISOString(),
    auto: true,
  };
  if (opts.projectId) {
    metadata.project_id = opts.projectId;
    metadata.project_name = projectName;
  }

  try {
    await query(
      `INSERT INTO knowledge_base_entries
         (user_id, content, source_type, entry_type, structured_data,
          review_status, tags, metadata,
          embedding, embedding_model, project_id)
       VALUES ($1, $2, 'manual', 'conversation_digest', $3,
               'approved', $4, $5,
               $6, $7, $8)`,
      [
        opts.userId,
        structured.summary,
        JSON.stringify(structured),
        JSON.stringify(tags),
        JSON.stringify(metadata),
        embeddingValue,
        embeddingModel,
        opts.projectId ?? null,
      ]
    );
    // 顺手把摘要回写 conversations.summary
    await query("UPDATE conversations SET summary = $1 WHERE id = $2", [
      structured.summary,
      opts.conversationId,
    ]);
    return { saved: true };
  } catch (e) {
    console.error("[autoDigest] 入库失败:", e);
    return { saved: false, skipped: true, reason: "入库失败" };
  }
}
