// POST /api/skills/competitive-landscape
// 机构版专属：基于中鉴 zjjr_features 向量检索，生成竞争格局分析报告。
// 要求：登录 + 项目写权限 + org zjjr_data 能力位。

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
import { injectOrgKnowledge, injectMarketContext } from "@/lib/orgInject";
import { hasCapability } from "@/lib/orgAuth";

export const maxDuration = 90;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  judgment_points: string[];
}

// zjjr_features 是否有真实数据（条数大于阈值视为已接入真实数据）
async function hasRealZjjrData(): Promise<boolean> {
  try {
    const rows = await query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM zjjr_features WHERE embedding IS NOT NULL`
    );
    return parseInt(rows[0]?.cnt ?? "0", 10) >= 10;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { project_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const projectId = body.project_id;
  if (!projectId) {
    return NextResponse.json({ error: "缺少 project_id" }, { status: 400 });
  }

  // 访问校验 + org 上下文
  const scope = await buildAccessScope(userId);
  let projectOrgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, projectId, "write");
    projectOrgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }

  // zjjr_data 能力位门控（必须为机构版且已开通）
  if (!scope.org || !(await hasCapability(scope.org.orgId, "zjjr_data"))) {
    return NextResponse.json(
      { error: "竞争格局分析仅机构版且开通中鉴数据增强后可用" },
      { status: 403 }
    );
  }

  // 读取项目
  const projects = await query<ProjectRow>(
    `SELECT name, company_name, industry, stage, judgment_points
       FROM projects WHERE id = $1`,
    [projectId]
  );
  if (projects.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const project = projects[0];

  // AI 凭据
  const creds = await loadUserAICredentials(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  // 真实数据判断（用于末尾免责附注）
  const realData = await hasRealZjjrData();
  const sampleDataNote = realData
    ? ""
    : "\n\n---\n> ⚠️ 当前基于示例数据，中鉴数据接入后将显示真实市场情报。";

  // 判断要点摘要
  const judPoints = Array.isArray(project.judgment_points)
    ? project.judgment_points.filter(Boolean)
    : [];
  const judSummary =
    judPoints.length > 0
      ? `\n## 投资人初步判断要点\n${judPoints.map((p) => `- ${p}`).join("\n")}`
      : "";

  // 检索 query（项目名 + 行业 + 阶段，用于中鉴向量检索）
  const retrievalQuery = [project.name, project.industry, project.stage]
    .filter(Boolean)
    .join(" ");

  // 构建 system prompt
  const baseSystem = `你是一位资深一级股权投资市场分析师，专注于基金备案数据与竞争格局研究。
请基于检索到的中鉴基金研究院市场参考数据，为投资人提供结构化的竞争格局分析，输出内容必须扎实、\
有据可查，信息不足时如实标注，不得编造。`;

  let systemPrompt = await injectProfile(userId, baseSystem);
  systemPrompt = await injectOrgKnowledge(scope, retrievalQuery, systemPrompt);
  systemPrompt = await injectMarketContext(scope, retrievalQuery, systemPrompt);

  // 用户侧 prompt
  const userContent = `请对以下项目所在赛道进行竞争格局分析，聚焦已备案机构的投资行为与市场覆盖。

## 项目信息
- 名称：${project.name}
- 公司主体：${project.company_name || "（未填写）"}
- 行业 / 赛道：${project.industry || "（未填写）"}
- 融资阶段：${project.stage || "（未填写）"}
${judSummary}

请按以下结构输出 Markdown 报告，语言简洁专业，避免套话：

## 一、同赛道活跃机构分布
列出检索到的在该赛道有投资活动的机构，说明各机构的投资偏好（阶段偏好、出手频次、典型被投企业特征）。如无充分数据，请如实说明。

## 二、当前竞争格局判断
- 赛道拥挤程度（稀缺 / 竞争激烈 / 已红海）
- 主要玩家的投资策略差异
- 本项目面临的同机构竞争压力

## 三、尚未被充分覆盖的白地方向
基于已投机构的覆盖盲区，识别 2–4 个尚未被充分关注的子赛道、阶段或类型，说明白地成因与机会逻辑。

## 四、对本项目的竞争格局含义
本项目在以上格局中处于什么位置？是否存在机构背书空白或抢筹窗口？${sampleDataNote}`;

  // 预创建报告占位
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, kind, status, org_id)
     VALUES ($1, $2, $3, '', 'analysis', 'draft', $4)
     RETURNING id`,
    [projectId, userId, `【竞争格局】${project.name}`, projectOrgId]
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
