import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { decrypt } from "@/lib/crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { injectProfile } from "@/lib/user-profile";

export const maxDuration = 60;

interface Chunk {
  content: string;
  source_type: string | null;
  score: number;
}

// 各 provider 的 OpenAI 兼容接口配置
const providerConfig: Record<string, { baseURL: string; model: string }> = {
  openai: { baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  doubao: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-pro-32k",
  },
  minimax: { baseURL: "https://api.minimax.chat/v1", model: "abab6.5s-chat" },
  claude: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-3-5-haiku-20241022",
  },
};

// POST /api/knowledge/search — 全文检索 + 向量检索合并，再用 AI 综合回答
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    question?: string;
    entry_type?: string[];
    source_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "请输入问题" }, { status: 422 });
  }

  const ALLOWED_ENTRY_TYPES = new Set([
    "industry",
    "project",
    "thesis",
    "prediction",
    "chunk",
    "manual",
    "conversation_digest",
    "document_chunk",
  ]);
  const ALLOWED_SOURCE_TYPES = new Set(["manual", "document", "report"]);
  const filterEntryTypes = Array.isArray(body.entry_type)
    ? body.entry_type.filter((s) => typeof s === "string" && ALLOWED_ENTRY_TYPES.has(s))
    : [];
  const filterSourceType =
    typeof body.source_type === "string" && ALLOWED_SOURCE_TYPES.has(body.source_type)
      ? body.source_type
      : "";

  // 构造可复用的 WHERE 子句片段（针对 knowledge_base_entries）
  const kbExtraWhere: string[] = [];
  const kbExtraParams: unknown[] = [];
  if (filterEntryTypes.length > 0) {
    kbExtraParams.push(filterEntryTypes);
    kbExtraWhere.push(`entry_type = ANY($PARAM::text[])`);
  }
  if (filterSourceType) {
    kbExtraParams.push(filterSourceType);
    kbExtraWhere.push(`source_type = $PARAM`);
  }
  function buildKbWhere(baseParams: unknown[]): {
    sql: string;
    params: unknown[];
  } {
    let idx = baseParams.length;
    const sqlParts = kbExtraWhere.map((clause) => {
      idx += 1;
      return clause.replace("$PARAM", `$${idx}`);
    });
    return {
      sql: sqlParts.length > 0 ? " AND " + sqlParts.join(" AND ") : "",
      params: [...baseParams, ...kbExtraParams],
    };
  }

  const userRows = await query<{
    ai_provider: string | null;
    api_key_encrypted: string | null;
  }>("SELECT ai_provider, api_key_encrypted FROM users WHERE id = $1", [
    session.user.id,
  ]);
  const user = userRows[0];

  // 解密 API Key（失败则视作未配置）
  let apiKey: string | null = null;
  if (user?.api_key_encrypted) {
    try {
      apiKey = decrypt(user.api_key_encrypted);
    } catch {
      apiKey = null;
    }
  }

  // 1. 全文检索（所有用户都走这一步）
  const ftsBase = [session.user.id, question];
  const ftsExtra = buildKbWhere(ftsBase);
  const ftsRows = await query<Chunk>(
    `SELECT content, source_type,
            ts_rank(search_vector, plainto_tsquery('simple', $2)) AS score
       FROM knowledge_base_entries
      WHERE user_id = $1
        AND search_vector @@ plainto_tsquery('simple', $2)
        ${ftsExtra.sql}
      ORDER BY score DESC
      LIMIT 8`,
    ftsExtra.params
  );
  const retrievedChunks: Chunk[] = [...ftsRows];
  const seen = new Set(retrievedChunks.map((c) => c.content));
  const addChunks = (rows: Chunk[], weight: number) => {
    for (const row of rows) {
      const chunk = { ...row, score: row.score * weight };
      if (!seen.has(chunk.content)) {
        retrievedChunks.push(chunk);
        seen.add(chunk.content);
      }
    }
  };

  // 2. 向量检索（百炼可用时补充）
  const embResult = await generateEmbedding(question);
  if (embResult) {
    const vecBase = [session.user.id, `[${embResult.vector.join(",")}]`];
    const vecExtra = buildKbWhere(vecBase);
    const vectorRows = await query<Chunk>(
      `SELECT content, source_type,
              1 - (embedding <=> $2::vector) AS score
         FROM knowledge_base_entries
        WHERE user_id = $1
          AND embedding IS NOT NULL
          ${vecExtra.sql}
        ORDER BY embedding <=> $2::vector
        LIMIT 8`,
      vecExtra.params
    );
    // 合并去重，向量结果得分加权
    addChunks(vectorRows, 1.2);
  }

  // 3. 文档分块检索（document_chunks）：优先向量，否则回退全文 ILIKE
  //    若用户已显式过滤到非 document 来源 / 非 document_chunk 类型，则跳过
  const skipDocChunks =
    (filterSourceType && filterSourceType !== "document") ||
    (filterEntryTypes.length > 0 && !filterEntryTypes.includes("document_chunk"));
  if (!skipDocChunks && embResult) {
    const chunkRows = await query<{ content: string; score: number }>(
      `SELECT content,
              1 - (embedding <=> $2::vector) AS score
         FROM document_chunks
        WHERE user_id = $1
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT 6`,
      [session.user.id, `[${embResult.vector.join(",")}]`]
    );
    addChunks(
      chunkRows.map((r) => ({ ...r, source_type: "document" })),
      1.2
    );
  } else if (!skipDocChunks) {
    const chunkRows = await query<{ content: string }>(
      `SELECT content FROM document_chunks
        WHERE user_id = $1 AND content ILIKE $2
        LIMIT 6`,
      [session.user.id, `%${question}%`]
    );
    addChunks(
      chunkRows.map((r) => ({ content: r.content, source_type: "document", score: 0.5 })),
      1
    );
  }

  // 4. 检索相关项目的投资判断记录
  const judgments = await query<{
    stage: string;
    bull_case: string | null;
    bear_case: string | null;
    founder_assessment: string | null;
    key_hypothesis: string | null;
    confidence_level: number | null;
    created_at: string;
    project_name: string;
  }>(
    `SELECT ij.stage, ij.bull_case, ij.bear_case,
            ij.founder_assessment, ij.key_hypothesis,
            ij.confidence_level, ij.created_at,
            p.name AS project_name
       FROM investment_judgments ij
       JOIN projects p ON ij.project_id = p.id
      WHERE ij.user_id = $1
        AND (
          p.name ILIKE $2
          OR ij.bull_case ILIKE $2
          OR ij.bear_case ILIKE $2
        )
      ORDER BY ij.created_at DESC
      LIMIT 5`,
    [session.user.id, `%${question}%`]
  );

  // 按得分排序，取前 6 条作为上下文
  retrievedChunks.sort((a, b) => b.score - a.score);
  const context = retrievedChunks.slice(0, 6);

  if (context.length === 0 && judgments.length === 0) {
    return NextResponse.json({
      answer: "知识库中暂无相关内容，请先录入一些文档或笔记。",
      sources: [],
    });
  }

  // 5. AI 综合回答（流式）
  if (!apiKey) {
    return NextResponse.json({
      answer: "请先在设置页配置 AI API Key，以启用智能问答。",
      sources: context,
    });
  }

  let contextText = context
    .map((c, i) => `[${i + 1}] (来源: ${c.source_type ?? "未知"})\n${c.content}`)
    .join("\n\n---\n\n");

  if (judgments.length > 0) {
    const judgmentText = judgments
      .map((j) => {
        const parts = [
          j.bull_case && `看好的理由：${j.bull_case}`,
          j.bear_case && `主要顾虑：${j.bear_case}`,
          j.founder_assessment && `对创始人的判断：${j.founder_assessment}`,
          j.key_hypothesis && `关键待验证假设：${j.key_hypothesis}`,
          j.confidence_level && `信心评分：${j.confidence_level}/5`,
        ].filter(Boolean);
        return `项目「${j.project_name}」·${j.stage} 阶段（${new Date(
          j.created_at
        ).toLocaleDateString("zh-CN")}）\n${parts.join("\n")}`;
      })
      .join("\n\n---\n\n");
    contextText +=
      (contextText ? "\n\n===== 相关投资判断记录 =====\n\n" : "") +
      judgmentText;
  }

  const provider = user?.ai_provider ?? "deepseek";
  const aiKey = apiKey; // 经上方校验，此处必为字符串
  const userQuestion = question; // 经上方校验，此处必为字符串
  const baseSystem = `你是投资人的私人知识助手。根据以下知识库内容回答问题，保持专业、简洁。
如果知识库内容不足以回答，请明确说明。不要编造信息。
知识库内容：\n\n${contextText}`;
  const systemPrompt = await injectProfile(session.user.id, baseSystem);

  // 按 provider 选择 SDK，统一产出文本增量流
  async function* answerStream(): AsyncGenerator<string> {
    if (provider === "claude" || provider === "anthropic") {
      const client = new Anthropic({ apiKey: aiKey });
      const stream = client.messages.stream({
        model: providerConfig.claude.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userQuestion }],
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
      return;
    }

    const config = providerConfig[provider] ?? providerConfig.deepseek;
    const client = new OpenAI({ apiKey: aiKey, baseURL: config.baseURL });
    const stream = await client.chat.completions.create({
      model: config.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuestion },
      ],
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) yield text;
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      // 先发 sources
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "sources", sources: context })}\n\n`
        )
      );
      for await (const text of answerStream()) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", text })}\n\n`)
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
