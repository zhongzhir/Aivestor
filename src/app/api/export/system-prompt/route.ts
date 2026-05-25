import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { getUserProfile, formatProfileForPrompt } from "@/lib/user-profile";
import { EXPORT_FOOTER } from "@/lib/export";

export const maxDuration = 90;

const COMPRESS_SYSTEM = `你是一个 prompt 工程专家。用户会提供一位一级股权投资人的画像、知识库精选条目与自建分析 SKILL。
请把这些材料整合压缩为一段【可直接作为 AI 工具 system prompt 使用】的「投资人 DNA」描述。

要求：
- 用第二人称写给 AI（如「你将扮演一位…」「在分析项目时，你应当…」）。
- 结构化、分点清晰，覆盖：投资人定位与专注领域、核心判断框架与偏好、明确回避的雷区、输出风格要求。
- 提炼共性与方法论，不要罗列流水账，不要照抄原文。
- 简体中文，总长度严格控制在 2000 字以内。
- 直接输出 system prompt 正文，不要任何解释、标题或代码块包裹。`;

interface KbRow {
  entry_type: string | null;
  source_type: string | null;
  title: string | null;
  content: string;
}

interface SkillRow {
  name: string;
  description: string | null;
  prompt_template: string;
}

function formatKb(rows: KbRow[]): string {
  if (rows.length === 0) return "（无）";
  return rows
    .map((r, i) => {
      const head = r.title?.trim() ? `${r.title.trim()}` : `条目 ${i + 1}`;
      return `【${i + 1}】${head}\n${r.content.trim().slice(0, 600)}`;
    })
    .join("\n\n");
}

function formatSkills(rows: SkillRow[]): string {
  if (rows.length === 0) return "（无）";
  return rows
    .map((s, i) => {
      const desc = s.description?.trim() ? `（${s.description.trim()}）` : "";
      return `【${i + 1}】${s.name}${desc}\n${s.prompt_template
        .trim()
        .slice(0, 400)}`;
    })
    .join("\n\n");
}

// POST /api/export/system-prompt — 调 AI 把投资人画像+知识库+SKILL 压缩为 system prompt
export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 1. 画像
  const profile = await getUserProfile(userId);
  const profileText = profile ? formatProfileForPrompt(profile) : "";

  // 2. 知识库精选：投资逻辑 / 行业认知 / 预测复盘 + 手动笔记，取最近 50 条
  const kb = await query<KbRow>(
    `SELECT entry_type, source_type, title, content
       FROM knowledge_base_entries
      WHERE user_id = $1
        AND (entry_type IN ('thesis', 'industry', 'prediction', 'manual')
             OR source_type = 'manual')
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId]
  );

  // 3. 自建 SKILL
  const skills = await query<SkillRow>(
    `SELECT name, description, prompt_template
       FROM user_custom_skills
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId]
  );

  if (!profileText && kb.length === 0 && skills.length === 0) {
    return NextResponse.json(
      { error: "暂无可导出的数据，请先完善投资人画像或沉淀知识库" },
      { status: 400 }
    );
  }

  const creds = await loadUserAICredentials(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "请先在设置中配置 API Key" },
      { status: 400 }
    );
  }

  const userContent = `## 投资人画像
${profileText || "（未填写）"}

## 知识库精选条目
${formatKb(kb)}

## 自建分析 SKILL
${formatSkills(skills)}

请据此整合压缩为 2000 字以内的「投资人 DNA」system prompt。`;

  let prompt = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, userId, "export-system-prompt"),
      system: COMPRESS_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    })) {
      prompt += chunk;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 调用失败" },
      { status: 500 }
    );
  }

  const finalPrompt = `${prompt.trim()}\n\n---\n${EXPORT_FOOTER}`;
  return NextResponse.json({ prompt: finalPrompt });
}
