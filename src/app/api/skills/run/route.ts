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
import { buildSkillRunPrompt } from "@/lib/skillPrompt";
import {
  buildAccessScope,
  assertProjectAccess,
  scopedProjectChildWhere,
  type AccessScope,
} from "@/lib/resourceAccess";
import { injectOrgKnowledge, injectMarketContext } from "@/lib/orgInject";

export const maxDuration = 120;

interface JudgmentRow {
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

const EMPTY = "（未关联项目，无相关数据）";

// 单篇文档注入上限，避免超出 token 限制
const DOC_CHAR_LIMIT = 8000;

interface ProjectVars {
  // 供模板 {占位符} 替换的变量
  vars: Record<string, string>;
  // 当模板未引用任何项目占位符时，整体前置注入的上下文块
  contextBlock: string;
  hasDocs: boolean;
  // 机构知识注入的检索 query 用
  project: { name: string; industry: string | null };
}

// 组装关联项目的注入变量
async function buildProjectVars(
  projectId: string,
  scope: AccessScope
): Promise<ProjectVars | null> {
  // 项目归属校验（read）：无权访问返回 null（与原 user_id 不命中等价）
  try {
    await assertProjectAccess(scope, projectId, "read");
  } catch {
    return null;
  }
  const projects = await query<{
    name: string;
    industry: string | null;
    summary: string | null;
    process_stage: string;
    financial_data: unknown;
  }>(
    `SELECT name, industry, summary, process_stage, financial_data
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId]
  );
  if (projects.length === 0) return null;
  const p = projects[0];

  // 子资源（文档）可见性跟随项目；个人版退化为 user_id = $2，与现状等价。
  const docScope = scopedProjectChildWhere(scope, 2);

  const projectInfo = [
    `项目名称：${p.name}`,
    `行业/赛道：${p.industry || "（未标注）"}`,
    `当前阶段：${STAGE_LABELS[p.process_stage] ?? p.process_stage}`,
    `项目概述：${p.summary || "（未填写）"}`,
  ].join("\n");

  // 取该项目下所有解析成功的文档（按上传时间正序），用户归属校验
  // BP 上下文仅包含商业/研究/其他类文档，把 contract / financial_model / news 排除
  const docs = await query<{ filename: string; extracted_text: string | null }>(
    `SELECT filename, extracted_text FROM documents
      WHERE project_id = $1 AND ${docScope.sql}
        AND parse_status = 'done' AND extracted_text IS NOT NULL
        AND doc_kind IN ('bp', 'research', 'other')
      ORDER BY created_at ASC`,
    [projectId, ...docScope.params]
  );
  const docParts = docs.map(
    (d) => `【${d.filename}】\n${(d.extracted_text || "").slice(0, DOC_CHAR_LIMIT)}`
  );
  const hasDocs = docParts.length > 0;
  const bpContent = hasDocs ? docParts.join("\n\n") : "（未上传文档）";

  // 合同/法律文档单独取，作为 {contract_content} 占位符注入
  const contractDocs = await query<{
    filename: string;
    extracted_text: string | null;
  }>(
    `SELECT filename, extracted_text FROM documents
      WHERE project_id = $1 AND ${docScope.sql}
        AND parse_status = 'done' AND extracted_text IS NOT NULL
        AND doc_kind = 'contract'
      ORDER BY created_at ASC`,
    [projectId, ...docScope.params]
  );
  const contractContent =
    contractDocs.length > 0
      ? contractDocs
          .map(
            (d) =>
              `【${d.filename}】\n${(d.extracted_text || "").slice(0, DOC_CHAR_LIMIT)}`
          )
          .join("\n\n---\n\n")
      : "（本项目暂未上传合同/法律文件）";

  const financialData = p.financial_data
    ? JSON.stringify(p.financial_data)
    : "（暂无财务数据）";

  // 判断记录仅取本人（组织项目下他人判断不经此路径，见 1.2 矩阵）
  const judgmentRows = await query<JudgmentRow>(
    `SELECT stage, bull_case, bear_case, founder_assessment,
            key_hypothesis, confidence_level, created_at
       FROM investment_judgments
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at DESC`,
    [projectId, scope.userId]
  );
  const judgments =
    judgmentRows.length === 0
      ? "（暂无判断记录）"
      : judgmentRows
          .map((j) => {
            const date = new Date(j.created_at).toLocaleDateString("zh-CN");
            const parts = [
              j.bull_case && `看好的理由：${j.bull_case}`,
              j.bear_case && `主要顾虑：${j.bear_case}`,
              j.founder_assessment && `对创始人的判断：${j.founder_assessment}`,
              j.key_hypothesis && `关键待验证假设：${j.key_hypothesis}`,
              j.confidence_level && `信心评分：${j.confidence_level}/5`,
            ].filter(Boolean);
            return `【${STAGE_LABELS[j.stage] ?? j.stage}·${date}】\n${
              parts.join("\n") || "（无具体内容）"
            }`;
          })
          .join("\n\n");

  const vars: Record<string, string> = {
    project_info: projectInfo,
    bp_content: bpContent,
    financial_data: financialData,
    judgments,
    contract_content: contractContent,
  };

  // 前置注入块：模板未引用占位符时，把真实材料拼到 prompt 前面
  const contextBlock = [
    projectInfo,
    hasDocs
      ? `\n以下是该项目提交的材料内容：\n\n${docParts.join("\n\n")}`
      : "",
    p.financial_data ? `\n财务数据：${financialData}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    vars,
    contextBlock,
    hasDocs,
    project: { name: p.name, industry: p.industry },
  };
}

// POST /api/skills/run — 运行 SKILL（流式）
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    skill_id?: string;
    skill_type?: string;
    project_id?: string;
    extra_input?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { skill_id, skill_type, project_id, extra_input } = body;
  if (!skill_id || (skill_type !== "catalog" && skill_type !== "custom")) {
    return NextResponse.json({ error: "参数不合法" }, { status: 422 });
  }

  const scope = await buildAccessScope(session.user.id);

  // 1. 读取 SKILL 模板
  let promptTemplate: string;
  if (skill_type === "catalog") {
    const rows = await query<{ prompt_template: string }>(
      "SELECT prompt_template FROM skill_catalog WHERE id = $1 AND is_active = true",
      [skill_id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }
    promptTemplate = rows[0].prompt_template;
  } else {
    // 自建 SKILL：本人的 + 组织共享的（org_id = 本 org）均可运行（1.2 矩阵）。
    // 个人版退化为仅 user_id = $2，与现状等价。
    const orgId = scope.org?.orgId ?? null;
    const rows = await query<{ prompt_template: string }>(
      `SELECT prompt_template FROM user_custom_skills
        WHERE id = $1 AND (user_id = $2${orgId ? " OR org_id = $3" : ""})`,
      orgId ? [skill_id, session.user.id, orgId] : [skill_id, session.user.id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }
    promptTemplate = rows[0].prompt_template;
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 2. 注入变量
  let vars: Record<string, string> = {
    project_info: EMPTY,
    bp_content: EMPTY,
    financial_data: EMPTY,
    judgments: EMPTY,
    contract_content: EMPTY,
  };
  let prependContext = "";
  let project: { name: string; industry: string | null } | null = null;
  if (project_id) {
    const projectVars = await buildProjectVars(project_id, scope);
    if (!projectVars) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    vars = projectVars.vars;
    project = projectVars.project;

    // 若模板未引用任何项目占位符（常见于用户自建 SKILL），
    // 则把项目资料整体前置注入，确保 AI 能拿到真实材料。
    const usesPlaceholders = Object.keys(vars).some((key) =>
      promptTemplate.includes(`{${key}}`)
    );
    if (!usesPlaceholders) {
      prependContext = projectVars.contextBlock;
    }
  }

  // 3. 组装最终 prompt。补充说明必须前置并设为高优先级约束，否则容易被通用模板吞没。
  const prompt = buildSkillRunPrompt({
    promptTemplate,
    vars,
    prependContext,
    extraInput: extra_input,
  });

  // 4. 注入链：个人画像 → 机构知识沉淀（个人版 / 无能力位时返回原文）
  let system = await injectProfile(
    session.user.id,
    "你是一位资深的一级股权投资专家，输出使用简体中文与 Markdown 格式，专业、具体、有洞察力。",
    {
      projectName: project?.name,
      industry: project?.industry,
      explicitInstruction: extra_input,
      projectJudgments:
        project && vars.judgments !== EMPTY ? [vars.judgments] : [],
      taskText: [promptTemplate, extra_input].filter(Boolean).join("\n"),
    }
  );
  const retrievalQuery = [project?.name, project?.industry, extra_input]
    .filter(Boolean)
    .join(" ");
  system = await injectOrgKnowledge(scope, retrievalQuery, system);
  // 中鉴市场上下文注入（无 org / 无 zjjr_data 能力位 / 无命中时返回原文）
  system = await injectMarketContext(scope, retrievalQuery, system);

  // 5. 流式调用 AI
  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "skill-run"),
    system,
    messages: [{ role: "user", content: prompt }],
  });

  return streamTextResponse(generator, async () => {});
}
