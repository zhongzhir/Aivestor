import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";

export const maxDuration = 90;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
}

interface JudgmentRow {
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
}

interface KbHit {
  content: string;
  source_type: string | null;
}

// POST /api/projects/[id]/brief-analysis
// 简要分析：原则性框架评估，无 3 条判断门槛、不强制 BP 文档。
// 调用 streamChat 流式生成，存入 reports 表，title 前缀「【简要分析】」。
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 1. 项目（含归属校验）
  const projects = await query<ProjectRow>(
    `SELECT name, company_name, industry, stage
       FROM projects WHERE id = $1 AND user_id = $2`,
    [params.id, userId]
  );
  if (projects.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const project = projects[0];

  // 2. AI 凭据
  const creds = await loadUserAICredentials(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 3. BP 文本（best effort：未上传也允许继续）
  const docs = await query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM documents
      WHERE project_id = $1 AND extracted_text IS NOT NULL
      ORDER BY created_at ASC`,
    [params.id]
  );
  const bpText = docs
    .map((d) => d.extracted_text)
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 3000);

  // 4. 已有的投资判断（不强制要求）
  const judgments = await query<JudgmentRow>(
    `SELECT bull_case, bear_case, founder_assessment,
            key_hypothesis, confidence_level
       FROM investment_judgments
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at ASC`,
    [params.id, userId]
  );
  const judgmentSummary = judgments
    .filter((j) => j.bull_case || j.bear_case || j.founder_assessment || j.key_hypothesis)
    .map((j) => {
      const parts: string[] = [];
      if (j.bull_case) parts.push(`看好：${j.bull_case}`);
      if (j.bear_case) parts.push(`顾虑：${j.bear_case}`);
      if (j.founder_assessment) parts.push(`创始人：${j.founder_assessment}`);
      if (j.key_hypothesis) parts.push(`核心假设：${j.key_hypothesis}`);
      if (j.confidence_level != null) parts.push(`信心：${j.confidence_level}/5`);
      return `- ${parts.join("；")}`;
    })
    .join("\n");

  // 5. 私有知识库相关条目（简单全文检索；失败不阻断）
  let kbContext = "";
  try {
    const ftsQuery = [project.name, project.industry, project.stage]
      .filter(Boolean)
      .join(" ");
    if (ftsQuery.trim()) {
      const kbHits = await query<KbHit>(
        `SELECT content, source_type,
                ts_rank(search_vector, plainto_tsquery('simple', $2)) AS score
           FROM knowledge_base_entries
          WHERE user_id = $1
            AND search_vector @@ plainto_tsquery('simple', $2)
          ORDER BY score DESC
          LIMIT 5`,
        [userId, ftsQuery]
      );
      if (kbHits.length > 0) {
        kbContext = kbHits
          .map((h) => `- (${h.source_type ?? "未知"}) ${h.content.slice(0, 300)}`)
          .join("\n");
      }
    }
  } catch (e) {
    console.error("[brief-analysis] 知识库检索失败（忽略）:", e);
  }

  // 6. 拼装 prompt
  const baseSystem = `你是一位资深的一级股权投资分析助手，帮投资人对项目做\
原则性框架评估（简要分析，非深度尽调）。
请基于投资人画像、知识库相关条目以及项目当前已掌握信息，给出快速但贴合\
投资人视角的判断；信息缺失时如实指出，不要编造。
${
  kbContext
    ? `\n投资人知识库中与该项目相关的参考（同类项目或历史判断）：\n${kbContext}`
    : ""
}`;

  const systemPrompt = await injectProfile(userId, baseSystem);

  const userContent = `请对以下项目进行简要分析（约 500-800 字），这是一次快速入库评估，\
不需要进入深度尽调。

## 项目基本信息
- 名称：${project.name}
- 公司主体：${project.company_name || "（未填写）"}
- 行业：${project.industry || "（未填写）"}
- 阶段：${project.stage || "（未填写）"}

## BP / 材料摘要
${bpText || "（未上传材料，或材料尚未解析）"}

${judgmentSummary ? `## 投资人已记录的初步判断\n${judgmentSummary}\n` : ""}
请用以下结构输出 Markdown，语言简洁直接，避免套话：

## 快速印象
（1-2 句话，第一直觉）

## 与投资逻辑的契合度
（对照投资人画像，这个项目是否在其关注范围内，为什么）

## 主要吸引力
（最多 3 条，每条 1-2 句，实质性亮点）

## 主要疑虑
（最多 3 条，每条 1-2 句，关键风险或不确定性）

## 当前阶段判断
（一句话：暂不跟进 / 保持关注 / 建议推进接触，并说明核心理由）

## 后续跟进触发条件
（如果是「保持关注」或「暂不跟进」，列出哪些信息/进展会触发重新评估）`;

  // 7. 预创建报告占位，便于在响应头返回 reportId
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status)
     VALUES ($1, $2, $3, '', 'draft')
     RETURNING id`,
    [params.id, userId, `【简要分析】${project.name}`]
  );
  const reportId = created[0].id;

  // 8. 调 AI 流式输出，结束后回填 content
  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, userId, "brief-analysis"),
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const res = streamTextResponse(generator, async (fullText) => {
    await query("UPDATE reports SET content = $1 WHERE id = $2", [
      fullText,
      reportId,
    ]);
  });
  res.headers.set("X-Report-Id", reportId);
  return res;
}
