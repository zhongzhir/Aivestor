import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import { requireOrgAPI, hasCapability } from "@/lib/orgAuth";

export const maxDuration = 120;

const UPDATE_TYPE_LABEL: Record<string, string> = {
  regular: "常规跟进",
  milestone: "里程碑",
  risk: "风险事项",
  financing: "融资动态",
  personnel: "人事变动",
  exit: "退出事件",
};

// LP 报告生成 system prompt：固定七章节结构（架构 7.3）。
const LP_SYSTEM = `你是一名专业的基金投资经理，正在为基金的有限合伙人（LP）撰写一份正式的投资报告。
请基于下方提供的组合层聚合数据，输出一份结构严谨、措辞专业的中文 Markdown 报告，严格按以下七个章节组织：

## 一、基金概况与报告期说明
## 二、投资组合总览
（以列表呈现在投项目：名称 / 赛道 / 轮次 / 投资时间 / 当前状态）
## 三、本期投资动态
（新增投资、退出事件）
## 四、重点项目进展
（按投后跟踪记录中的里程碑、融资类事项逐项说明）
## 五、风险事项
（汇总风险类投后记录）
## 六、下期展望
## 七、附注与免责声明

要求：
- 只使用提供的数据，不臆造未提供的数字或事实；数据缺失的章节如实说明"本期暂无相关记录"。
- 语气克制、客观，面向机构投资人。
- 附注与免责声明中说明本报告基于内部跟踪数据整理，不构成任何投资建议。`;

// 把一段日期字符串校验为 YYYY-MM-DD；非法返回 null。
function parseDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
}

// POST /api/org/lp-reports — 生成 LP 报告（流式）。权限 partner+，能力位 lp_reports。
export async function POST(req: Request) {
  const guard = await requireOrgAPI("partner");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  if (!(await hasCapability(ctx.orgId, "lp_reports"))) {
    return NextResponse.json({ error: "组织未开通 LP 报告能力" }, { status: 403 });
  }

  const creds = await loadUserAICredentials(ctx.userId);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  let body: { periodStart?: unknown; periodEnd?: unknown; projectIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const periodStart = parseDate(body.periodStart);
  const periodEnd = parseDate(body.periodEnd);
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json(
      { error: "请选择有效的报告时间区间" },
      { status: 400 }
    );
  }
  // 可选项目范围（限定为本 org 在投项目子集）
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.map(String).filter(Boolean)
    : [];

  // 组合层聚合：在投项目 + 区间内投后跟踪 + 投后阶段判断。
  const projParams: unknown[] = [ctx.orgId];
  let projScope = "";
  if (projectIds.length > 0) {
    projParams.push(projectIds);
    projScope = ` AND id = ANY($${projParams.length}::uuid[])`;
  }
  const invested = await query<{
    id: string;
    name: string;
    industry: string | null;
    stage: string | null;
    status: string;
  }>(
    `SELECT id, name, industry, stage, status
       FROM projects
      WHERE org_id = $1 AND deleted_at IS NULL AND status = 'invested'${projScope}
      ORDER BY name ASC`,
    projParams
  );

  const updParams: unknown[] = [ctx.orgId, periodStart, periodEnd];
  let updScope = "";
  if (projectIds.length > 0) {
    updParams.push(projectIds);
    updScope = ` AND p.id = ANY($${updParams.length}::uuid[])`;
  }
  const updates = await query<{
    name: string;
    update_type: string;
    content: string;
    period: string | null;
    created_at: string;
  }>(
    `SELECT p.name, pu.update_type, pu.content, pu.period, pu.created_at
       FROM post_investment_updates pu
       JOIN projects p ON p.id = pu.project_id
      WHERE p.org_id = $1
        AND p.deleted_at IS NULL
        AND pu.created_at >= $2::date
        AND pu.created_at < ($3::date + INTERVAL '1 day')${updScope}
      ORDER BY pu.created_at ASC`,
    updParams
  );

  // 拼装喂给模型的数据块（结构化、紧凑）。
  const dataLines: string[] = [];
  dataLines.push(`报告期：${periodStart} 至 ${periodEnd}`);
  dataLines.push(`组织：${ctx.orgName}`);
  dataLines.push("");
  dataLines.push("【在投项目清单】");
  if (invested.length === 0) {
    dataLines.push("（本期无在投项目记录）");
  } else {
    for (const p of invested) {
      dataLines.push(
        `- ${p.name}｜赛道：${p.industry ?? "未标注"}｜阶段：${p.stage ?? "未标注"}｜状态：${p.status}`
      );
    }
  }
  dataLines.push("");
  dataLines.push("【报告期内投后跟踪记录】");
  if (updates.length === 0) {
    dataLines.push("（本期无投后跟踪记录）");
  } else {
    for (const u of updates) {
      const date = new Date(u.created_at).toISOString().slice(0, 10);
      dataLines.push(
        `- [${date}][${UPDATE_TYPE_LABEL[u.update_type] ?? u.update_type}] ${u.name}：${u.content}`
      );
    }
  }
  const dataBlock = dataLines.join("\n");

  // 创建 lp_report 占位行：project_id 为 NULL，挂 org_id（迁移 026 不变量）。
  const created = await query<{ id: string }>(
    `INSERT INTO reports (project_id, user_id, title, content, status, kind, org_id)
     VALUES (NULL, $1, $2, '', 'draft', 'lp_report', $3)
     RETURNING id`,
    [ctx.userId, `【LP 报告】${periodStart}~${periodEnd}`, ctx.orgId]
  );
  const reportId = created[0].id;

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, ctx.userId, "lp-report"),
    system: await injectProfile(ctx.userId, LP_SYSTEM),
    messages: [{ role: "user", content: dataBlock }],
  });

  const res = streamTextResponse(
    generator,
    async (fullText) => {
      await query("UPDATE reports SET content = $1 WHERE id = $2", [
        fullText,
        reportId,
      ]);
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

// GET /api/org/lp-reports — 列表（含内容，便于前端点选载入）。kind='lp_report' AND org_id=$1。
export async function GET() {
  const guard = await requireOrgAPI("partner");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  if (!(await hasCapability(ctx.orgId, "lp_reports"))) {
    return NextResponse.json({ error: "组织未开通 LP 报告能力" }, { status: 403 });
  }

  const reports = await query<{
    id: string;
    title: string;
    content: string;
    version: number;
    conversation_history: { instruction: string; ts: string }[];
    created_at: string;
  }>(
    `SELECT id, title, content, version, conversation_history, created_at
       FROM reports
      WHERE kind = 'lp_report' AND org_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [ctx.orgId]
  );
  return NextResponse.json({ reports });
}
