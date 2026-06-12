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
import { STAGE_LABELS } from "@/lib/stages";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

export const maxDuration = 120;

type Tool = "devil" | "outside" | "mirror";

const PROMPTS: Record<Tool, string> = {
  devil: `你是一位经验丰富、持怀疑态度的投资委员会成员。
你的任务是对以下项目提出系统性质疑，帮助投资人发现潜在风险和盲点。
不要客气，要像真正的投委会辩论一样直接。

{industryContext}

项目信息：
{projectInfo}

BP内容摘要：
{bpContent}

投资人当前判断：
{judgments}

请先根据该项目所处行业/赛道的特点，调整你的质疑重点（例如：消费品重渠道效率与复购率、硬科技重技术壁垒与量产能力、SaaS 重净留存与规模化扩张），再从以下维度逐一分析，每个维度给出具体质疑（不要泛泛而谈）：
1. 商业模式的核心假设——最可能被证伪的假设是什么？
2. 市场规模——TAM 是否被高估？增长逻辑是否成立？
3. 团队能力缺口——这个阶段最缺什么能力？
4. 竞争壁垒——护城河是否真实存在还是自我描述？
5. 财务预测——最乐观假设下还有哪些隐患？
6. 一个致命问题——如果只能问创始人一个问题，你会问什么？

对以上每个质疑点，额外标注：该类问题在这个赛道的历史失败案例中出现的频率（高/中/低），并简要说明依据。

最后，请切换立场：如果你是这家公司的创始人，你会如何逐条反驳上述质疑？通过这种自我对抗，明确指出哪些质疑是真正致命的、哪些其实站不住脚。`,

  outside: `你是一个多视角分析助手。请从四个非投资人视角审视这个项目，
帮助投资人跳出专业视角的局限。

{industryContext}

项目信息：
{projectInfo}

BP内容摘要：
{bpContent}

请分别从以下四个视角给出分析：

## 用户视角
作为目标用户，这个产品真的解决了我的痛点吗？我会付费吗？我会推荐给朋友吗？
有哪些体验细节可能让我流失？

## 竞争对手视角
如果我是这个赛道最强的竞争对手，我如何看待这家公司？
他们的威胁在哪里？我会怎么防御或反击？

## 监管与社会视角
这个商业模式在政策层面有哪些潜在风险？
是否存在社会争议点？监管趋严会如何影响这个业务？

## 潜在收购方视角
如果一家战略投资者或产业方考虑收购这家公司，他们会看重什么（技术、团队、用户、数据、渠道协同）？又会顾虑什么（整合难度、估值泡沫、关键人依赖、业务重叠）？
这个视角直接关系到一级投资的退出路径，请具体分析该项目对潜在收购方的吸引力与障碍。`,

  mirror: `你是一位投资复盘专家。请结合投资人的历史判断记录与你所知的行业公开案例，
分析当前项目与历史案例的相似性，提供参考。

{industryContext}

当前项目：
{projectInfo}

投资人历史判断记录：
{judgments}

请分析：
1. 当前项目与历史判断中哪些案例最相似？相似点在哪里？
2. 投资人在相似项目上的判断模式是什么？
3. 历史上类似判断的结果如何？有什么值得借鉴的教训？
4. 基于历史模式，当前项目最需要警惕的是什么？

如果投资人的历史判断记录为空、或仅有当前项目这一条，不要简单地说"数据不足"。请改为：
- 基于当前项目信息与所处赛道，主动类比该行业内你已知的公开案例（知名公司的成败历史）；
- 说明这些公开案例与当前项目的相似点、当时的关键判断、以及最终结果（成功/失败/转型）；
- 提炼这些案例对当前项目的参考价值，以及值得警惕之处。`,
};

interface ProjectRow {
  name: string;
  summary: string | null;
  industry: string | null;
  process_stage: string;
  financial_data: unknown;
}

// 从项目 industry 字段或 financial_data 中提取行业标签
function extractIndustry(
  industry: string | null,
  financialData: unknown
): string | null {
  if (industry && industry.trim()) return industry.trim();
  if (financialData && typeof financialData === "object") {
    const fd = financialData as Record<string, unknown>;
    for (const key of ["industry", "sector", "行业", "赛道"]) {
      const v = fd[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

interface JudgmentRow {
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
  project_name?: string;
}

function formatJudgments(rows: JudgmentRow[], crossProject: boolean): string {
  if (rows.length === 0) {
    return "（暂无判断记录）";
  }
  return rows
    .map((j) => {
      const head = crossProject
        ? `项目「${j.project_name}」·${STAGE_LABELS[j.stage] ?? j.stage}阶段`
        : `${STAGE_LABELS[j.stage] ?? j.stage}阶段`;
      const date = new Date(j.created_at).toLocaleDateString("zh-CN");
      const parts = [
        j.bull_case && `看好的理由：${j.bull_case}`,
        j.bear_case && `主要顾虑：${j.bear_case}`,
        j.founder_assessment && `对创始人的判断：${j.founder_assessment}`,
        j.key_hypothesis && `关键待验证假设：${j.key_hypothesis}`,
        j.confidence_level && `信心评分：${j.confidence_level}/5`,
      ].filter(Boolean);
      return `【${head}·${date}】\n${parts.join("\n") || "（无具体内容）"}`;
    })
    .join("\n\n");
}

// POST /api/projects/[id]/decision — 决策辅助分析（流式）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { tool?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const tool = body.tool as Tool;
  if (!["devil", "outside", "mirror"].includes(tool)) {
    return NextResponse.json({ error: "工具类型不合法" }, { status: 422 });
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 校验项目归属（read）
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch (e) {
    return accessErrorResponse(e);
  }

  // 1. 项目信息（访问已校验，按 id 取）
  const projects = await query<ProjectRow>(
    `SELECT name, summary, industry, process_stage, financial_data
       FROM projects WHERE id = $1`,
    [params.id]
  );
  if (projects.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const project = projects[0];

  const industry = extractIndustry(project.industry, project.financial_data);
  const industryContext = industry
    ? `项目所处行业/赛道：${industry}
请在分析中充分结合该赛道的典型规律、关键指标与风险特征，使质疑与判断更具行业针对性。`
    : `项目行业/赛道：未明确标注。请先根据 BP 内容与项目概述推断其所处赛道，再据此展开有行业针对性的分析。`;

  const projectInfo = [
    `项目名称：${project.name}`,
    `项目概述：${project.summary || "（未填写）"}`,
    `行业/赛道：${industry || "（未标注）"}`,
    `当前阶段：${STAGE_LABELS[project.process_stage] ?? project.process_stage}`,
    project.financial_data
      ? `财务数据：${JSON.stringify(project.financial_data)}`
      : "财务数据：（暂无）",
  ].join("\n");

  // 2. 最新一份文档文本
  const docs = await query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM documents
      WHERE project_id = $1
        AND extracted_text IS NOT NULL
        AND doc_kind IN ('bp', 'research', 'other')
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.id]
  );
  const bpContent = docs[0]?.extracted_text?.slice(0, 8000) || "（未上传文档）";

  // 3. 判断记录：mirror 跨项目取全部，其余仅本项目
  let judgmentText: string;
  if (tool === "mirror") {
    const allJudgments = await query<JudgmentRow>(
      `SELECT ij.stage, ij.bull_case, ij.bear_case,
              ij.founder_assessment, ij.key_hypothesis,
              ij.confidence_level, ij.created_at,
              p.name AS project_name
         FROM investment_judgments ij
         JOIN projects p ON ij.project_id = p.id
        WHERE ij.user_id = $1
        ORDER BY ij.created_at DESC
        LIMIT 20`,
      [session.user.id]
    );
    judgmentText = formatJudgments(allJudgments, true);
  } else {
    const projectJudgments = await query<JudgmentRow>(
      `SELECT stage, bull_case, bear_case, founder_assessment,
              key_hypothesis, confidence_level, created_at
         FROM investment_judgments
        WHERE project_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [params.id, session.user.id]
    );
    judgmentText = formatJudgments(projectJudgments, false);
  }

  // 4. 组装 Prompt
  const prompt = PROMPTS[tool]
    .replace("{industryContext}", industryContext)
    .replace("{projectInfo}", projectInfo)
    .replace("{bpContent}", bpContent)
    .replace("{judgments}", judgmentText);

  // 5. 流式调用 AI
  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "decision"),
    system: await injectProfile(
      session.user.id,
      "你是一位资深的一级股权投资专家，输出使用简体中文与 Markdown 格式。"
    ),
    messages: [{ role: "user", content: prompt }],
  });

  // 决策分析结果不持久化
  return streamTextResponse(generator, async () => {});
}
