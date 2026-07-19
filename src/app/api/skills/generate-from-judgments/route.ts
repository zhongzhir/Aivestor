import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { isValidSkillCategory } from "@/lib/skills";

export const maxDuration = 90;

const MIN_JUDGMENTS = 5;

const JUDGMENT_ANALYSIS_SYSTEM = `你是一个投资框架分析专家。
分析投资人的历史判断记录，提炼其个人投资框架，生成一个专属的投资分析 SKILL。

输出严格 JSON 格式：
{
  "name": "SKILL 名称（体现个人风格，如「XX 的创始人评估框架」）",
  "description": "100 字以内描述这个 SKILL 的分析视角",
  "category": "analysis | due_diligence | valuation | post_investment 之一",
  "prompt": "200-400 字的分析 prompt，融入用户的判断模式和关注点，以「请基于上传的项目材料，」开头"
}

只输出 JSON，不要有任何其他内容。`;

interface JudgmentRow {
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
  project_name: string;
}

function formatJudgments(rows: JudgmentRow[]): string {
  return rows
    .map((j, i) => {
      const parts: string[] = [`【${i + 1}】${j.project_name} · ${j.stage}`];
      if (j.bull_case) parts.push(`看好：${j.bull_case}`);
      if (j.bear_case) parts.push(`顾虑：${j.bear_case}`);
      if (j.founder_assessment)
        parts.push(`创始人：${j.founder_assessment}`);
      if (j.key_hypothesis) parts.push(`核心假设：${j.key_hypothesis}`);
      if (j.confidence_level != null)
        parts.push(`信心：${j.confidence_level}/5`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function extractJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("未找到 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// POST /api/skills/generate-from-judgments
export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 1. 读取用户所有判断
  const judgments = await query<JudgmentRow>(
    `SELECT ij.stage, ij.bull_case, ij.bear_case, ij.founder_assessment,
            ij.key_hypothesis, ij.confidence_level, ij.created_at,
            p.name AS project_name
       FROM investment_judgments ij
       JOIN projects p ON p.id = ij.project_id
      WHERE ij.user_id = $1 AND p.deleted_at IS NULL
      ORDER BY ij.created_at DESC
      LIMIT 50`,
    [session.user.id]
  );

  if (judgments.length < MIN_JUDGMENTS) {
    return NextResponse.json(
      {
        error: `至少需要 ${MIN_JUDGMENTS} 条判断记录才能生成专属 SKILL（当前 ${judgments.length} 条）`,
      },
      { status: 400 }
    );
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "请先在设置中配置 API Key" },
      { status: 400 }
    );
  }

  // 2. 调 AI 提炼
  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "skill-from-judgments"),
      system: JUDGMENT_ANALYSIS_SYSTEM,
      messages: [
        {
          role: "user",
          content: `以下是这位投资人最近 ${judgments.length} 条判断记录，请据此生成专属 SKILL：\n\n${formatJudgments(judgments)}`,
        },
      ],
    })) {
      raw += chunk;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 调用失败" },
      { status: 500 }
    );
  }

  // 3. 解析
  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(raw);
  } catch {
    return NextResponse.json(
      { error: "AI 返回无法解析为 JSON，请重试", raw: raw.slice(0, 500) },
      { status: 500 }
    );
  }

  const name =
    typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim().slice(0, 100)
      : "我的投资框架";
  const description =
    typeof parsed.description === "string"
      ? parsed.description.trim().slice(0, 1000)
      : null;
  const promptTemplate =
    typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
  if (!promptTemplate) {
    return NextResponse.json(
      { error: "AI 生成的 prompt 为空，请重试" },
      { status: 500 }
    );
  }
  const category =
    typeof parsed.category === "string" && isValidSkillCategory(parsed.category)
      ? parsed.category
      : null;

  const metadata = {
    generated_from_judgments: true,
    judgment_count: judgments.length,
    generated_at: new Date().toISOString(),
  };

  // 4. 入库
  try {
    const rows = await query<{
      id: string;
      name: string;
      description: string | null;
      category: string | null;
      prompt_template: string;
      applicable_stages: string[];
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO user_custom_skills
         (user_id, name, description, category, prompt_template,
          applicable_stages, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, description, category, prompt_template,
                 applicable_stages, created_at, updated_at`,
      [
        session.user.id,
        name,
        description,
        category,
        promptTemplate,
        [], // applicable_stages 留空让用户自行勾选
        JSON.stringify(metadata),
      ]
    );
    return NextResponse.json({ skill: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[generate-from-judgments] 入库失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
