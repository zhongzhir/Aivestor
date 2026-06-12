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
import type { FinancialData } from "@/lib/types";

export const maxDuration = 120;

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  financial_data: FinancialData | null;
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

const TERM_SHEET_SYSTEM = `你是一位经验丰富的一级市场投资律师和投资人，正在为一笔股权投资起草投资条款清单（Term Sheet）初稿。

你的任务是基于项目信息、财务数据和投资人的判断，生成一份结构完整、条款清晰的 Term Sheet 初稿。

## 输出格式要求

使用 Markdown 格式，按以下结构输出：

# Term Sheet 初稿
## 《[项目名称]》股权投资条款清单

**声明：本文件为 AI 辅助生成的初稿，仅供参考，不构成正式法律文件。正式条款谈判请结合专业律师意见。**

---

## 一、基本交易信息
| 条款 | 内容 |
|------|------|
| 发行方 | |
| 投资方 | |
| 投资金额 | |
| 投前估值 | |
| 投后估值 | |
| 持股比例 | |
| 股票类型 | 优先股 |
| 本轮融资总额 | |
| 交割条件 | |

## 二、优先权条款
| 条款 | 内容 | 说明 |
|------|------|------|
| 清算优先权 | 1x 非参与型（建议） | 公司清算时优先收回投资本金 |
| 反稀释保护 | 加权平均（建议） | 防止后续低价融资稀释 |
| 优先购买权 | 有 | 后续融资轮次的参与权 |
| 转换权 | 可转换为普通股 | IPO 时自动转换 |

## 三、治理条款
| 条款 | 内容 |
|------|------|
| 董事会席位 | |
| 保护性条款 | |
| 信息权 | 季度财务报告 + 年度审计报告 |
| 检查权 | 合理频率的实地检查权 |

## 四、转让限制
| 条款 | 内容 |
|------|------|
| 共同售股权（Tag-Along） | |
| 领售权（Drag-Along） | |
| 优先购买权（ROFR） | |
| 锁定期 | |

## 五、创始人条款
| 条款 | 内容 |
|------|------|
| 股权成熟计划（Vesting） | |
| 竞业禁止 | |
| 核心人员锁定 | |

## 六、其他条款
| 条款 | 内容 |
|------|------|
| 排他期 | 签署后 [X] 天内排他谈判 |
| 适用法律 | 中华人民共和国法律 |
| 争议解决 | |
| 有效期 | 本 Term Sheet 自签署之日起 [X] 天内有效 |

## 七、起草说明与风险提示

**基于现有信息的判断：**
[根据项目情况说明关键条款的选择逻辑]

**需要重点谈判的条款：**
[列出2-3个建议重点关注的条款及原因]

**信息缺口：**
[列出生成本初稿时缺少的关键信息，建议补充后重新生成]

---
⚠️ **免责声明：本文件为 AI 辅助生成的参考初稿，不构成正式法律意见或投资承诺。条款内容需根据实际谈判情况调整，请务必在专业律师指导下完成正式文件签署。**`;

// POST /api/projects/[id]/term-sheet
// Term Sheet 初稿生成：基于项目信息流式生成，存入 reports 表（kind = term_sheet）。
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 0. 读取请求体（extra_input 可选）
  let extraInput = "";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.extra_input === "string") {
      extraInput = body.extra_input.trim().slice(0, 2000);
    }
  } catch {
    // 空 body 也允许
  }

  // 1. 项目（含归属校验，write）；orgId 用于报告跟随父项目
  const scope = await buildAccessScope(userId);
  let projectOrgId: string | null = null;
  try {
    const info = await assertProjectAccess(scope, params.id, "write");
    projectOrgId = info.orgId;
  } catch (e) {
    return accessErrorResponse(e);
  }
  const projects = await query<ProjectRow>(
    `SELECT name, company_name, industry, stage, financial_data
       FROM projects WHERE id = $1`,
    [params.id]
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
      WHERE project_id = $1
        AND extracted_text IS NOT NULL
        AND doc_kind IN ('bp', 'research', 'other')
      ORDER BY created_at ASC`,
    [params.id]
  );
  const bpText = docs
    .map((d) => d.extracted_text)
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 6000);

  // 4. 已有的投资判断
  const judgments = await query<JudgmentRow>(
    `SELECT bull_case, bear_case, founder_assessment,
            key_hypothesis, confidence_level
       FROM investment_judgments
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at ASC`,
    [params.id, userId]
  );
  const judgmentsText = judgments
    .filter(
      (j) =>
        j.bull_case || j.bear_case || j.founder_assessment || j.key_hypothesis
    )
    .map((j) => {
      const parts: string[] = [];
      if (j.bull_case) parts.push(`看好：${j.bull_case}`);
      if (j.bear_case) parts.push(`顾虑：${j.bear_case}`);
      if (j.founder_assessment) parts.push(`创始人：${j.founder_assessment}`);
      if (j.key_hypothesis) parts.push(`核心假设：${j.key_hypothesis}`);
      if (j.confidence_level != null)
        parts.push(`信心：${j.confidence_level}/5`);
      return `- ${parts.join("；")}`;
    })
    .join("\n");

  // 5. 知识库检索（失败静默）
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
          LIMIT 3`,
        [userId, ftsQuery]
      );
      if (kbHits.length > 0) {
        kbContext = kbHits
          .map(
            (h) => `- (${h.source_type ?? "未知"}) ${h.content.slice(0, 200)}`
          )
          .join("\n");
      }
    }
  } catch (e) {
    console.error("[term-sheet] 知识库检索失败（忽略）:", e);
  }

  // 6. 拼装 prompt
  const baseSystem = `${TERM_SHEET_SYSTEM}${
    kbContext
      ? `\n\n## 投资人知识库中的可参考条款实践\n${kbContext}`
      : ""
  }`;

  const systemPrompt = await injectProfile(userId, baseSystem);

  const projectInfo = [
    `项目名称：${project.name}`,
    `公司主体：${project.company_name || "（未填写）"}`,
    `行业：${project.industry || "（未填写）"}`,
    `融资阶段：${project.stage || "（未填写）"}`,
  ].join("\n");

  const financialBlock = project.financial_data
    ? JSON.stringify(project.financial_data, null, 2)
    : "暂无结构化财务数据";

  const userPrompt = `请基于以下项目信息，生成一份 Term Sheet 初稿。

## 项目基本信息
${projectInfo}

## 商业计划书摘要
${bpText || "（未上传材料，或材料尚未解析）"}

## 财务数据
${financialBlock}

## 投资人判断记录
${judgmentsText || "暂无判断记录"}

${extraInput ? `## 投资人补充说明（请优先参考）\n${extraInput}\n` : ""}请严格按照系统提示的格式输出完整的 Term Sheet 初稿，所有表格中暂时未知的字段填写"[待定]"，并在"信息缺口"部分列出。`;

  // 7. 预创建报告占位（kind = term_sheet）
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status, kind, org_id)
     VALUES ($1, $2, $3, '', 'draft', 'term_sheet', $4)
     RETURNING id`,
    [params.id, userId, `【Term Sheet 初稿】${project.name}`, projectOrgId]
  );
  const reportId = created[0].id;

  // 8. 流式生成并回填
  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, userId, "term-sheet"),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
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
