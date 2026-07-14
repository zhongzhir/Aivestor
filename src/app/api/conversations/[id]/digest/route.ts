import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import { generateEmbedding } from "@/lib/embedding";

export const maxDuration = 120;

interface Msg {
  role: "user" | "assistant";
  content: string;
  ts?: string;
}

interface ConvoRow {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  messages: Msg[];
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

function formatHistory(history: Msg[]): string {
  return history
    .map((m) => {
      const label = m.role === "user" ? "投资人" : "AI";
      return `【${label}】${m.content}`;
    })
    .join("\n\n");
}

function buildDigestPrompt(title: string, conversation: string): string {
  return `以下是一段投资人与 AI 的独立对话${title ? `（标题：「${title}」）` : ""}。

请提炼对话中的认知价值，重点提炼投资人的思考，
同时精炼 AI 有价值的观点（有时 AI 的视角更开阔，值得保留）。

以 JSON 格式输出，不要输出任何其他内容：
{
  "key_insights": ["最重要的判断或认知，3条以内，每条不超过50字"],
  "open_questions": ["对话结束后仍未解答的核心疑问，2条以内"],
  "mindset_shift": "与对话开始相比，认知发生了什么变化。若无明显变化填null",
  "watch_points": ["后续需要重点核实的事项，2条以内"],
  "summary": "对话核心的100字以内摘要，第一人称，代表投资人视角"
}

如果对话内容过于零散、无实质性判断价值，请返回：{"skip": true, "reason": "原因说明"}

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

function describePgError(e: unknown) {
  const err = e as {
    code?: string;
    message?: string;
    detail?: string;
    table?: string;
  };
  return {
    code: err?.code,
    message: err?.message,
    detail: err?.detail,
    table: err?.table,
  };
}

// POST /api/conversations/[id]/digest — 提炼摘要（不入库）
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let rows: ConvoRow[];
  try {
    rows = await query<ConvoRow>(
      `SELECT c.id, c.title, c.project_id, p.name AS project_name, c.messages
         FROM conversations c
         LEFT JOIN projects p ON p.id = c.project_id
        WHERE c.id = $1 AND c.user_id = $2`,
      [params.id, session.user.id]
    );
  } catch (e) {
    const info = describePgError(e);
    console.error("[conversation-digest][POST] 读取对话失败:", info, e);
    if (info.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "对话表不存在 —— 请执行数据库迁移 db/migrations/013_conversations.sql",
          code: info.code,
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: info.message || "读取对话失败", code: info.code },
      { status: 500 }
    );
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  const convo = rows[0];
  const history = Array.isArray(convo.messages) ? convo.messages : [];
  if (history.length < 3) {
    return NextResponse.json(
      { error: "对话内容不足，至少需要 3 轮对话后才能提炼" },
      { status: 400 }
    );
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  const userPrompt = buildDigestPrompt(
    convo.title ?? "",
    formatHistory(history)
  );

  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "conversation-digest"),
      system: await injectProfile(session.user.id, DIGEST_SYSTEM),
      messages: [{ role: "user", content: userPrompt }],
    })) {
      raw += chunk;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 调用失败" },
      { status: 500 }
    );
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return NextResponse.json(
      { error: "AI 返回内容无法解析为 JSON，请重试", raw: raw.slice(0, 500) },
      { status: 500 }
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.skip) {
    return NextResponse.json({
      skip: true,
      reason: typeof obj.reason === "string" ? obj.reason : "对话信息量不足",
    });
  }

  const structured: DigestStructured = {
    key_insights: Array.isArray(obj.key_insights)
      ? (obj.key_insights.filter((x) => typeof x === "string") as string[])
      : [],
    open_questions: Array.isArray(obj.open_questions)
      ? (obj.open_questions.filter((x) => typeof x === "string") as string[])
      : [],
    mindset_shift:
      typeof obj.mindset_shift === "string" && obj.mindset_shift.trim()
        ? obj.mindset_shift
        : null,
    watch_points: Array.isArray(obj.watch_points)
      ? (obj.watch_points.filter((x) => typeof x === "string") as string[])
      : [],
    summary:
      typeof obj.summary === "string" ? obj.summary : "（AI 未生成摘要）",
  };

  return NextResponse.json({
    structured_data: structured,
    project_id: convo.project_id,
    project_name: convo.project_name ?? "独立对话",
    conversation_title: convo.title,
  });
}

// PUT /api/conversations/[id]/digest — 写入知识库
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    structured_data?: Partial<DigestStructured>;
    project_id?: string | null;
    project_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const sd = body.structured_data;
  if (!sd || typeof sd.summary !== "string" || !sd.summary.trim()) {
    return NextResponse.json({ error: "摘要不能为空" }, { status: 422 });
  }

  // 校验对话归属并取标题（容错：表不存在时给具体提示）
  let owned: { id: string; title: string | null }[];
  try {
    owned = await query<{ id: string; title: string | null }>(
      "SELECT id, title FROM conversations WHERE id = $1 AND user_id = $2",
      [params.id, session.user.id]
    );
  } catch (e) {
    const info = describePgError(e);
    console.error("[conversation-digest][PUT] SELECT 失败:", info, e);
    if (info.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "对话表不存在 —— 请执行数据库迁移 db/migrations/013_conversations.sql",
          code: info.code,
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: info.message || "读取对话失败", code: info.code },
      { status: 500 }
    );
  }
  if (owned.length === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  const convoTitle = owned[0].title ?? "独立对话";

  const structured: DigestStructured = {
    key_insights: Array.isArray(sd.key_insights)
      ? sd.key_insights.filter((x) => typeof x === "string" && x.trim())
      : [],
    open_questions: Array.isArray(sd.open_questions)
      ? sd.open_questions.filter((x) => typeof x === "string" && x.trim())
      : [],
    mindset_shift:
      typeof sd.mindset_shift === "string" && sd.mindset_shift.trim()
        ? sd.mindset_shift
        : null,
    watch_points: Array.isArray(sd.watch_points)
      ? sd.watch_points.filter((x) => typeof x === "string" && x.trim())
      : [],
    summary: sd.summary.trim(),
  };

  const emb = await generateEmbedding(structured.summary);
  const embeddingModel = emb?.model ?? null;
  const embeddingValue = emb ? `[${emb.vector.join(",")}]` : null;

  const projectName = body.project_name?.trim() || convoTitle;
  const tags = ["对话提炼", projectName];
  const metadata: Record<string, unknown> = {
    source_conversation_id: params.id,
    conversation_title: convoTitle,
    digested_at: new Date().toISOString(),
  };
  if (body.project_id) {
    metadata.project_id = body.project_id;
    metadata.project_name = projectName;
  }

  let inserted: { id: string }[];
  try {
    inserted = await query<{ id: string }>(
      `INSERT INTO knowledge_base_entries
         (user_id, content, source_type, entry_type, structured_data,
          review_status, tags, metadata,
          embedding, embedding_model, project_id)
       VALUES ($1, $2, 'manual', 'conversation_digest', $3,
               'approved', $4, $5,
               $6, $7, $8)
       RETURNING id`,
      [
        session.user.id,
        structured.summary,
        JSON.stringify(structured),
        JSON.stringify(tags),
        JSON.stringify(metadata),
        embeddingValue,
        embeddingModel,
        body.project_id ?? null,
      ]
    );
  } catch (e) {
    const info = describePgError(e);
    console.error("[conversation-digest][PUT] INSERT 失败:", info, e);
    if (info.code === "42P01" || info.code === "42703") {
      return NextResponse.json(
        {
          error:
            "知识库表/列缺失 —— 请确认已执行迁移 011 / 012；详细信息见服务端日志",
          code: info.code,
          detail: info.detail,
        },
        { status: 500 }
      );
    }
    if (info.code === "23514") {
      return NextResponse.json(
        {
          error: "knowledge_base_entries 的 CHECK 约束失败（可能是 entry_type 旧约束未更新），请执行迁移 012",
          code: info.code,
          detail: info.detail,
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: info.message || "存入知识库失败", code: info.code, detail: info.detail },
      { status: 500 }
    );
  }

  // 顺手把摘要回写到 conversations.summary，方便列表展示
  try {
    await query("UPDATE conversations SET summary = $1 WHERE id = $2", [
      structured.summary,
      params.id,
    ]);
  } catch {
    // 非关键路径，失败忽略
  }

  return NextResponse.json({ success: true, entry_id: inserted[0].id });
}
