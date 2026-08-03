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
import { stripSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { STAGE_LABELS } from "@/lib/stages";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";
import { injectOrgKnowledge, injectMarketContext } from "@/lib/orgInject";

export const maxDuration = 120;

interface ReportRow {
  id: string;
  title: string;
  content: string | null;
}

interface MemberJudgmentRow {
  user_id: string;
  user_name: string | null;
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

// 单人判断拼装上限（架构文档 4.3）
const PER_MEMBER_CHAR_LIMIT = 2000;

// 「合伙人观点对比」章节：插入在「团队评估」之后（仅组织投委会总报告启用）。
const PARTNER_COMPARISON_RULE = `

补充章节（在「## 团队评估」之后、「## 财务分析」之前插入）：
  ## 合伙人观点对比
- 基于用户消息中「各合伙人独立判断」部分，分合伙人呈现其核心判断。
- 若多位合伙人判断存在分歧，必须并列呈现双方理由与各自 confidence_level，不得抹平分歧；总体「投资建议」需说明分歧对结论的影响。`;

// 把组织成员各自的最新判断（每人每阶段最新一条）拼为一段供 merge 参考。
function buildMemberJudgmentsBlock(rows: MemberJudgmentRow[]): string {
  if (rows.length === 0) return "";
  // 每人每阶段取最新一条（rows 已按 created_at DESC 排序）
  const seen = new Set<string>();
  const byUser = new Map<
    string,
    { name: string; items: MemberJudgmentRow[] }
  >();
  for (const r of rows) {
    const key = `${r.user_id}::${r.stage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = byUser.get(r.user_id) ?? {
      name: r.user_name?.trim() || "组织成员",
      items: [],
    };
    entry.items.push(r);
    byUser.set(r.user_id, entry);
  }

  const blocks: string[] = [];
  for (const { name, items } of byUser.values()) {
    const lines = items
      .map((j) => {
        const stage = STAGE_LABELS[j.stage] ?? j.stage;
        const parts = [
          j.bull_case && `看好：${j.bull_case}`,
          j.bear_case && `顾虑：${j.bear_case}`,
          j.founder_assessment && `创始人判断：${j.founder_assessment}`,
          j.key_hypothesis && `关键假设：${j.key_hypothesis}`,
          j.confidence_level != null && `信心：${j.confidence_level}/5`,
        ]
          .filter(Boolean)
          .join("；");
        return `- 【${stage}】${parts || "（无具体内容）"}`;
      })
      .join("\n");
    blocks.push(`#### ${name}\n${lines}`.slice(0, PER_MEMBER_CHAR_LIMIT));
  }
  return `\n\n## 各合伙人独立判断\n\n${blocks.join("\n\n")}`;
}

const MERGE_SYSTEM = `你是一位资深投资分析师，正在为投资决策委员会（投委会）撰写一份总报告。
你会收到同一个项目的多份已有分析报告（可能来自不同的分析框架 / SKILL / 阶段）。
请把它们整合、去重、调和冲突，提炼为一份连贯、结论导向的投委会总报告。

要求：
- 使用简体中文，专业、客观、有洞察力。
- 输出 Markdown，严格包含以下七个二级标题章节，顺序固定，使用「## 」：
  ## 执行摘要
  ## 项目概况
  ## 市场与竞争
  ## 团队评估
  ## 财务分析
  ## 风险与挑战
  ## 投资建议
- 综合多份报告的信息：消除重复表述；若不同报告存在矛盾，明确指出并给出倾向性判断。
- 「执行摘要」用 5 条以内要点概括核心结论与投资建议。
- 「投资建议」给出明确倾向（投 / 观望 / 不投）与关键前提条件。
- 不要编造源报告中不存在的数据；信息缺失处注明「源报告未覆盖」。
- 各章节用自然段落，必要时配合要点列表，避免空话套话。
- 直接输出报告正文，不要任何额外说明或开场白。`;

function buildMergeUserContent(
  reports: ReportRow[],
  memberJudgmentsBlock = ""
): string {
  const parts = reports.map((r, i) => {
    // 去掉源报告的溯源徽章与置信度 JSON 块，给 AI 更干净的输入
    const clean = stripSourceBadges(
      extractConfidence(r.content ?? "").cleanContent
    ).trim();
    return `### 源报告 ${i + 1}：${r.title}\n\n${clean || "（无内容）"}`;
  });
  return `## 待合并的源报告（共 ${reports.length} 份）

${parts.join("\n\n---\n\n")}${memberJudgmentsBlock}

请将以上分析整合为一份投委会总报告。`;
}

// POST /api/projects/[id]/reports/merge — 多报告合并生成投委会总报告（流式）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { reportIds?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const reportIds = Array.isArray(body.reportIds)
    ? body.reportIds.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  if (reportIds.length < 2) {
    return NextResponse.json(
      { error: "请至少选择 2 份报告进行合并" },
      { status: 400 }
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "投委会分析报告";

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 校验项目归属（write）。组织项目下投委会总报告生成是 partner+ 职能（1.2 矩阵）。
  const scope = await buildAccessScope(session.user.id);
  let projectOrgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, params.id, "write");
    projectOrgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }
  const projectContextRows = await query<{
    name: string;
    company_name: string | null;
    industry: string | null;
    process_stage: string | null;
  }>(
    `SELECT name, company_name, industry, process_stage
       FROM projects
      WHERE id = $1 AND deleted_at IS NULL`,
    [params.id]
  );
  const projectContext = projectContextRows[0];
  // 组织项目：analyst 不可生成投委会总报告。
  const isOrgCommittee = !!projectOrgId && !!scope.org;
  if (isOrgCommittee && scope.org!.role === "analyst") {
    return NextResponse.json(
      { error: "投委会总报告由 partner 及以上生成" },
      { status: 403 }
    );
  }

  // 读取选中的报告。组织项目（partner+）放宽到组织成员的报告；个人版仅本人。
  const reportScopeSql = isOrgCommittee
    ? "(user_id = $3 OR org_id = $4)"
    : "user_id = $3";
  const reportParams = isOrgCommittee
    ? [reportIds, params.id, session.user.id, projectOrgId]
    : [reportIds, params.id, session.user.id];
  const rows = await query<ReportRow>(
    `SELECT id, title, content
       FROM reports
      WHERE id = ANY($1::uuid[]) AND project_id = $2 AND ${reportScopeSql}`,
    reportParams
  );
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "选中的报告不足 2 份有效记录（可能不属于该项目）" },
      { status: 400 }
    );
  }

  // 按用户选择顺序排序，并过滤掉无正文的报告
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = reportIds
    .map((id) => byId.get(id))
    .filter((r): r is ReportRow => !!r && !!r.content && !!r.content.trim());
  if (ordered.length < 2) {
    return NextResponse.json(
      { error: "选中的报告正文内容不足，无法合并" },
      { status: 400 }
    );
  }

  // 组织投委会总报告：聚合各成员独立判断（每人每阶段最新一条）。
  let memberJudgmentsBlock = "";
  if (isOrgCommittee) {
    const judgmentRows = await query<MemberJudgmentRow>(
      `SELECT j.user_id, u.name AS user_name, j.stage,
              j.bull_case, j.bear_case, j.founder_assessment,
              j.key_hypothesis, j.confidence_level, j.created_at
         FROM investment_judgments j
         LEFT JOIN users u ON u.id = j.user_id
        WHERE j.project_id = $1 AND j.org_id = $2
        ORDER BY j.user_id, j.stage, j.created_at DESC`,
      [params.id, projectOrgId]
    );
    memberJudgmentsBlock = buildMemberJudgmentsBlock(judgmentRows);
  }
  const hasMemberJudgments = memberJudgmentsBlock.length > 0;

  // 先创建占位报告行（kind='committee'，统一数据语义）；生成完成后置为 finalized
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status, kind, org_id)
     VALUES ($1, $2, $3, '', 'draft', 'committee', $4)
     RETURNING id`,
    [params.id, session.user.id, `【总报告】${title}`, projectOrgId]
  );
  const reportId = created[0].id;

  // 仅当存在多成员判断时，才在 system 中插入「合伙人观点对比」章节规则
  // （个人版 / 无成员判断时产出与改造前完全一致）。
  const mergeSystem = hasMemberJudgments
    ? MERGE_SYSTEM + PARTNER_COMPARISON_RULE
    : MERGE_SYSTEM;
  let system = await injectProfile(session.user.id, mergeSystem, {
    projectName: projectContext?.name,
    companyName: projectContext?.company_name,
    industry: projectContext?.industry,
    stage: projectContext?.process_stage,
    taskText: "合并项目分析和投委会报告，比较判断与风险，不涉及融资配置或退出期限",
  });
  // 机构知识注入（无 org / 无能力位时返回原文）
  const mergeRetrievalQuery = ordered.map((r) => r.title).join(" ");
  system = await injectOrgKnowledge(scope, mergeRetrievalQuery, system);
  // 中鉴市场上下文注入（无 org / 无 zjjr_data 能力位 / 无命中时返回原文）
  system = await injectMarketContext(scope, mergeRetrievalQuery, system);

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "report-merge"),
    system,
    messages: [
      {
        role: "user",
        content: buildMergeUserContent(ordered, memberJudgmentsBlock),
      },
    ],
  });

  const res = streamTextResponse(
    generator,
    async (fullText) => {
      await query(
        "UPDATE reports SET content = $1, status = 'finalized' WHERE id = $2",
        [fullText, reportId]
      );
    },
    // 流中途失败：删除从未写入正文的占位行，避免空 draft 堆积（审计 F-17）。
    async () => {
      await query("DELETE FROM reports WHERE id = $1 AND content = ''", [
        reportId,
      ]);
    }
  );
  res.headers.set("X-Report-Id", reportId);
  return res;
}
