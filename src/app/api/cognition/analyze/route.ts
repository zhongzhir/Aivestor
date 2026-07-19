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
import {
  computeStats,
  formatStats,
  formatJudgments,
  type CognitionJudgment,
} from "@/lib/cognition";

export const maxDuration = 120;

const COGNITION_PROMPT = `你是一位专业的投资认知分析师。请基于以下投资人的历史判断记录，
深度分析其投资判断模式、思维倾向和潜在认知盲区。

判断记录统计：
{stats}

详细判断记录：
{judgments}

请从以下维度进行分析：

## 1. 判断模式识别
这位投资人在判断项目时，最常关注哪些维度？
看好理由和顾虑分别集中在哪些方面？是否有明显的偏好？

## 2. 信心评分规律
信心评分的分布如何？在什么情况下给高分/低分？
信心评分与最终 outcome 是否有相关性？

## 3. 潜在认知盲区
基于判断记录，这位投资人可能存在哪些系统性盲区？
（如：是否过于关注团队而忽视市场？是否对某类风险持续低估？）

## 4. 判断质量评估（如有 outcome 数据）
已有结果的项目中，当初的判断有多准确？
哪些判断是有效预警？哪些是误判？

## 5. 成长建议
基于以上分析，给出3条具体的、可操作的投资判断改进建议。

如果判断记录较少（少于5条），请如实说明数据不足，
并基于现有记录给出力所能及的初步观察。`;

// POST /api/cognition/analyze — 认知模式分析（流式）
export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  const rows = await query<CognitionJudgment>(
    `SELECT ij.project_id, p.name AS project_name, p.outcome,
            ij.stage, ij.bull_case, ij.bear_case, ij.founder_assessment,
            ij.key_hypothesis, ij.confidence_level, ij.created_at
       FROM investment_judgments ij
       JOIN projects p ON ij.project_id = p.id
      WHERE ij.user_id = $1 AND p.deleted_at IS NULL
      ORDER BY ij.created_at DESC`,
    [session.user.id]
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "暂无判断记录，无法进行认知分析" },
      { status: 422 }
    );
  }

  const stats = computeStats(rows);
  const prompt = COGNITION_PROMPT.replace(
    "{stats}",
    formatStats(rows, stats)
  ).replace("{judgments}", formatJudgments(rows));

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "cognition"),
    system: await injectProfile(
      session.user.id,
      "你是一位专业的投资认知分析师，输出使用简体中文与 Markdown 格式，洞察深刻、建议具体可操作。"
    ),
    messages: [{ role: "user", content: prompt }],
  });

  return streamTextResponse(generator, async () => {});
}
