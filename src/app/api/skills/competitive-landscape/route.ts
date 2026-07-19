// POST /api/skills/competitive-landscape
// 机构版专属：查询 zjjr_portfolio（被投企业）+ zjjr_investments（活跃机构），
// 生成竞争格局分析报告。
// 要求：登录 + org zjjr_data 能力位。
// Body: { project_id?: string; industry?: string }
//   - project_id 可选；有时创建 report 并返回 X-Report-Id
//   - industry 可选覆盖；无则读取 project.industry；两者都空返回 400

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
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";
import { injectOrgKnowledge } from "@/lib/orgInject";
import { hasCapability } from "@/lib/orgAuth";

export const maxDuration = 90;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  judgment_points: string[];
}

interface PortfolioRow {
  name: string;
  industry: string | null;
  region: string | null;
  city_district: string | null;
  latest_invest_date: string | null;
}

interface InvestorRow {
  canonical_name: string;
  stage: string | null;
  deal_count: number;
}

// zjjr_portfolio 是否有真实数据（≥10 条视为已接入）
async function hasRealZjjrData(): Promise<boolean> {
  try {
    const rows = await query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM zjjr_portfolio`
    );
    return parseInt(rows[0]?.cnt ?? "0", 10) >= 10;
  } catch {
    return false;
  }
}

// 固定说明：无命中时直接流式返回，不调用 AI
async function* noDataMessage(industry: string) {
  yield `**当前中鉴数据库中未找到「${industry}」赛道的被投企业记录。**

可能原因：
1. 赛道描述与数据库行业标签不匹配（建议尝试更通用的关键词，如"人工智能"而非"垂直领域AI"）
2. 该赛道在浙江/上海地区的备案投资记录尚少

建议操作：
- 修改项目行业标签，使用更通用的行业分类后重试
- 联系中鉴基金研究院获取定制化赛道数据

> 数据来源：中鉴基金研究院，覆盖浙江+上海地区，仅供参考。`;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { project_id?: string; industry?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const projectId = body.project_id?.trim() || null;
  const bodyIndustry = body.industry?.trim() || null;

  // org 上下文 + zjjr_data 能力位门控
  const scope = await buildAccessScope(userId);
  if (!scope.org || !(await hasCapability(scope.org.orgId, "zjjr_data"))) {
    return NextResponse.json(
      { error: "竞争格局分析仅机构版且开通中鉴数据增强后可用" },
      { status: 403 }
    );
  }

  // 项目访问校验（仅在有 project_id 时）
  let project: ProjectRow | null = null;
  let projectOrgId: string | null = null;
  if (projectId) {
    try {
      const info = await assertProjectAccess(scope, projectId, "write");
      projectOrgId = info.orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }
    const projects = await query<ProjectRow>(
      `SELECT name, company_name, industry, stage, judgment_points
         FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId]
    );
    if (projects.length === 0) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    project = projects[0];
  }

  // 行业关键词：body.industry → project.industry → 400
  const industry = bodyIndustry || project?.industry?.trim() || null;
  if (!industry) {
    return NextResponse.json(
      {
        error:
          "请先在项目中填写行业信息，或在分析时直接输入行业关键词",
      },
      { status: 400 }
    );
  }

  // AI 凭据（在查 DB 之前验证，避免无效查询）
  const creds = await loadUserAICredentials(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  const keyword = `%${industry}%`;

  // Q1：同赛道被投企业（竞争对手格局）
  const portfolioRows = await query<PortfolioRow>(
    `SELECT name, industry, region, city_district,
            latest_invest_date::text AS latest_invest_date
       FROM zjjr_portfolio
      WHERE industry ILIKE $1
      ORDER BY latest_invest_date DESC NULLS LAST
      LIMIT 20`,
    [keyword]
  ).catch(() => [] as PortfolioRow[]);

  // Q1 无命中：不调用 AI，直接返回固定说明
  if (portfolioRows.length === 0) {
    return streamTextResponse(noDataMessage(industry), async () => {});
  }

  // Q2：同赛道活跃投资机构
  const investorRows = await query<InvestorRow>(
    `SELECT zi.canonical_name, inv.stage, COUNT(*)::int AS deal_count
       FROM zjjr_investments inv
       JOIN zjjr_institutions zi ON zi.id = inv.institution_id
      WHERE inv.sector ILIKE $1
      GROUP BY zi.canonical_name, inv.stage
      ORDER BY deal_count DESC
      LIMIT 10`,
    [keyword]
  ).catch(() => [] as InvestorRow[]);

  // 真实数据判断（末尾附注）
  const realData = await hasRealZjjrData();
  const dataNote = realData
    ? "\n\n> 数据来源：中鉴基金研究院，覆盖浙江+上海地区，仅供参考。"
    : "\n\n> ⚠️ 当前基于示例数据，中鉴数据正式接入后将显示真实市场情报。\n> 数据来源：中鉴基金研究院，覆盖浙江+上海地区，仅供参考。";

  // 构建项目信息块
  const projectBlock = project
    ? `## 项目信息
- 名称：${project.name}
- 公司主体：${project.company_name || "（未填写）"}
- 行业 / 赛道：${project.industry || industry}
- 融资阶段：${project.stage || "（未填写）"}${
        Array.isArray(project.judgment_points) &&
        project.judgment_points.filter(Boolean).length > 0
          ? `\n- 投资人初步判断：${project.judgment_points
              .filter(Boolean)
              .map((p) => `\n  • ${p}`)
              .join("")}`
          : ""
      }`
    : `## 分析赛道\n行业关键词：${industry}`;

  // 构建中鉴数据块
  const portfolioBlock = portfolioRows
    .map((r) => {
      const loc = [r.region, r.city_district].filter(Boolean).join(" ");
      return `- ${r.name}${loc ? `（${loc}）` : ""}${r.latest_invest_date ? `，最新投资：${r.latest_invest_date}` : ""}`;
    })
    .join("\n");

  const investorBlock =
    investorRows.length > 0
      ? investorRows
          .map(
            (r) =>
              `- ${r.canonical_name}：${r.stage ? `偏好${r.stage}阶段，` : ""}出手 ${r.deal_count} 次`
          )
          .join("\n")
      : "（当前数据中无该赛道机构投资记录）";

  // System prompt
  const baseSystem = `你是一位资深一级股权投资市场分析师，专注于被投企业生态与竞争格局研究。
请严格基于下方提供的中鉴结构化数据进行分析，不得编造未出现在数据中的企业或机构名称。
信息不足时如实说明，而非泛泛而谈。`;

  let systemPrompt = await injectProfile(userId, baseSystem);
  const retrievalQuery = [project?.name, industry].filter(Boolean).join(" ");
  systemPrompt = await injectOrgKnowledge(scope, retrievalQuery, systemPrompt);

  // User prompt
  const userContent = `${projectBlock}

## 中鉴数据：同赛道被投企业（共 ${portfolioRows.length} 条）
${portfolioBlock}

## 中鉴数据：同赛道活跃投资机构
${investorBlock}

---

请按以下结构输出 Markdown 竞争格局分析报告，语言简洁专业：

## 一、同赛道已有哪些企业获得投资（竞争对手格局）
基于上方被投企业列表，归纳竞争对手格局：头部玩家、阶段分布、地域分布、近期活跃度。

## 二、哪些机构在投这个赛道（活跃投资方）
分析投资机构的出手偏好（阶段、频次），总结赛道资金热度。

## 三、白地分析（市场空缺或差异化机会）
基于已被覆盖企业的特征，识别 2–4 个尚未被充分关注的方向（子赛道、阶段、地域等），说明白地成因与机会逻辑。${dataNote}`;

  // 始终预创建报告（project_id 已在迁移 026 放宽为可空）；
  // 有 project_id：title 用项目名；无时：title 用行业关键词。
  const reportTitle = project
    ? `【竞争格局】${project.name}`
    : `【竞争格局】${industry}赛道分析`;
  const reportOrgId = projectOrgId ?? scope.org?.orgId ?? null;

  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, kind, status, org_id)
     VALUES ($1, $2, $3, '', 'analysis', 'draft', $4)
     RETURNING id`,
    [projectId, userId, reportTitle, reportOrgId]
  );
  const reportId = created[0].id;

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, userId, "competitive-landscape"),
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const res = streamTextResponse(
    generator,
    async (fullText) => {
      await query("UPDATE reports SET content = $1 WHERE id = $2", [
        fullText,
        reportId,
      ]);
    },
    async () => {
      await query("DELETE FROM reports WHERE id = $1 AND content = ''", [
        reportId,
      ]);
    }
  );
  res.headers.set("X-Report-Id", reportId);
  return res;
}
