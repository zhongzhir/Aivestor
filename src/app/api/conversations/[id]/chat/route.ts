import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat, type ChatMessage } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { buildMemoryContext } from "@/lib/memoryContext";
import { runAutoDigest, shouldAutoDigest } from "@/lib/autoDigest";
import { STAGE_LABELS } from "@/lib/stages";

export const maxDuration = 120;

interface Msg {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface ConvoRow {
  id: string;
  title: string | null;
  project_id: string | null;
  messages: Msg[];
}

interface ProjectRow {
  name: string;
  stage: string | null;
  status: string;
}

interface JudgmentRow {
  bull_case: string | null;
  bear_case: string | null;
  stage: string;
  created_at: string;
}

const BASE_SYSTEM = `你是 Aivestor 的 AI 助手，专为一级股权投资人设计。

你的角色：
- 帮助投资人深度思考项目、复盘判断、提炼经验
- 在对话中主动追问，帮助投资人厘清模糊的想法
- 结合投资人的知识库（已检索相关内容见下方）给出有针对性的回应
- 观点要有依据，不要泛泛而谈

对话风格：
- 直接、专业，不客套
- 善用追问帮助投资人深化思考
- 重要观点用清晰的结构表达

【偏好捕获】
当你在对话中发现用户表达了【新的】投资偏好、判断标准或规避模式时，
在回答末尾另起一行输出：
[SAVE_PREF: 用一句话总结这个新偏好]

例如：[SAVE_PREF: 偏好创始人有大厂背景，对纯学术创业团队持谨慎态度]

规则：
- 每次对话最多触发一次，且只在发现真正有价值的【新】偏好时触发，不要滥用
- 如果该偏好已在投资人画像中体现，请不要重复触发
- 标记必须独占一行，写在所有正文内容之后`;

async function buildProjectContext(
  projectId: string,
  userId: string
): Promise<string> {
  const projects = await query<ProjectRow>(
    "SELECT name, stage, status FROM projects WHERE id = $1 AND user_id = $2",
    [projectId, userId]
  );
  const project = projects[0];
  if (!project) return "";

  const judgments = await query<JudgmentRow>(
    `SELECT bull_case, bear_case, stage, created_at
       FROM investment_judgments
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at DESC LIMIT 2`,
    [projectId, userId]
  );

  const lines: string[] = [
    `## 当前关联项目：${project.name}`,
    `融资阶段：${project.stage || "未填写"} | 状态：${project.status}`,
  ];
  if (judgments.length > 0) {
    lines.push("最近的投资判断：");
    for (const j of judgments) {
      const parts: string[] = [];
      if (j.bull_case) parts.push(`看好：${j.bull_case}`);
      if (j.bear_case) parts.push(`顾虑：${j.bear_case}`);
      const stageLabel = STAGE_LABELS[j.stage] ?? j.stage;
      lines.push(`- 【${stageLabel}】${parts.join("；") || "（未填）"}`);
    }
  }
  return lines.join("\n");
}

// 简易标题生成：取首条用户消息，让 AI 起 10 字以内标题
async function generateTitle(
  provider: ReturnType<typeof Object>,
  apiKey: string,
  baseURL: string | undefined,
  freeQuotaMeta: { userId: string; feature: string } | undefined,
  firstMessage: string,
  reply: string
): Promise<string | null> {
  try {
    let title = "";
    for await (const chunk of streamChat({
      provider: provider as never,
      apiKey,
      baseURL,
      freeQuotaMeta,
      system:
        "你为一段对话生成一个 10 字以内的简洁标题，只输出标题文字本身，不要引号、不要标点、不要解释。",
      messages: [
        {
          role: "user",
          content: `用户首条消息：${firstMessage.slice(0, 300)}\nAI 回复（节选）：${reply.slice(0, 300)}\n\n请输出 10 字以内标题。`,
        },
      ],
    })) {
      title += chunk;
      if (title.length > 60) break; // 防止 AI 超出
    }
    title = title.trim().replace(/^["「『]|["」』]$/g, "").trim();
    if (!title) return null;
    return title.slice(0, 30);
  } catch {
    return null;
  }
}

// POST /api/conversations/[id]/chat — 流式对话
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const userMessage = body.message?.trim();
  if (!userMessage) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 422 });
  }

  const convos = await query<ConvoRow>(
    `SELECT id, title, project_id, messages
       FROM conversations
      WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (convos.length === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  const convo = convos[0];
  const history: Msg[] = Array.isArray(convo.messages) ? convo.messages : [];
  const isFirstTurn = history.length === 0;

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 构造 system prompt：memoryContext（画像 + 近期沉淀 + 相关知识库）+ 项目上下文
  const projectSection = convo.project_id
    ? await buildProjectContext(convo.project_id, session.user.id)
    : "";
  const memory = await buildMemoryContext(session.user.id, userMessage);
  const memoryHeader = memory.context
    ? `以下是关于这位投资人的背景信息，请在回答中自然地结合这些信息：\n\n${memory.context}\n\n---`
    : "";

  const systemPrompt = [memoryHeader, BASE_SYSTEM, projectSection]
    .filter(Boolean)
    .join("\n\n");

  // 把历史 + 当前消息组装为 messages
  const messages: ChatMessage[] = [
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userMessage },
  ];

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "chat"),
    system: systemPrompt,
    messages,
  });

  const encoder = new TextEncoder();
  const sourcesMeta = memory.sources.map((c) => ({
    content: c.content,
    source_type: c.source_type,
  }));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        // 先把检索来源以 SSE meta 发给客户端
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "sources", sources: sourcesMeta })}\n\n`
          )
        );
        for await (const chunk of generator) {
          full += chunk;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
            )
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`
          )
        );
      }

      // 检测并剥离 [SAVE_PREF: ...] 标记（不写入持久化对话，前端会单独处理）
      const prefMatch = full.match(/\[SAVE_PREF:\s*(.+?)\]/);
      const detectedPref = prefMatch ? prefMatch[1].trim() : null;
      const cleanedReply = prefMatch
        ? full.replace(/\n?\[SAVE_PREF:\s*.+?\]\s*$/, "").trim()
        : full;

      if (detectedPref) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "save_pref",
              pref: detectedPref,
            })}\n\n`
          )
        );
      }

      // 持久化对话（保存去掉标记后的版本）
      const now = new Date().toISOString();
      const updated: Msg[] = [
        ...history,
        { role: "user", content: userMessage, ts: now },
        { role: "assistant", content: cleanedReply, ts: new Date().toISOString() },
      ];
      try {
        await query(
          "UPDATE conversations SET messages = $1, updated_at = NOW() WHERE id = $2",
          [JSON.stringify(updated), params.id]
        );
      } catch (e) {
        console.error("[conversations] 保存失败:", e);
      }

      // 首轮对话生成标题
      if (isFirstTurn && full.trim()) {
        const title = await generateTitle(
          creds.provider,
          creds.apiKey,
          creds.baseURL,
          freeQuotaMetaFor(creds, session.user.id, "chat-title"),
          userMessage,
          full
        );
        if (title) {
          try {
            await query(
              "UPDATE conversations SET title = $1 WHERE id = $2",
              [title, params.id]
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "title", title })}\n\n`
              )
            );
          } catch (e) {
            console.error("[conversations] 标题保存失败:", e);
          }
        }
      }

      // 自动沉淀：达到阈值时同步触发（serverless 下不做 fire-and-forget）
      const totalCount = updated.length;
      if (shouldAutoDigest(totalCount)) {
        try {
          const result = await runAutoDigest({
            conversationId: params.id,
            userId: session.user.id,
            title: convo.title,
            projectId: convo.project_id,
            projectName: null,
            messages: updated.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            provider: creds.provider,
            apiKey: creds.apiKey,
            baseURL: creds.baseURL,
            freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "auto-digest"),
          });
          if (result.saved) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "auto_digest" })}\n\n`
              )
            );
          }
        } catch (e) {
          console.error("[conversations] auto-digest 失败:", e);
        }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
