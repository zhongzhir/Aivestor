import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

const TEMPLATE_LABELS: Record<string, string> = {
  internal_review: "内部投后复盘",
  lp_update: "LP 投后更新",
  assoc_update: "协会报送底稿",
};

interface ReportRow {
  id: string;
  title: string;
  content: string;
  status: string;
  template_key: string;
  review_status: string;
  period_start: string | null;
  period_end: string | null;
  updated_at: string;
  export_count: string;
}

function firstSentence(value: string) {
  return value.split(/[\n。；;]/).map((item) => item.trim()).filter(Boolean)[0]?.slice(0, 180) ?? value.slice(0, 180);
}

function buildMarkdown(input: {
  projectName: string;
  templateKey: string;
  period: string | null;
  updates: { update_type: string; content: string; period: string | null }[];
  metrics: { metric_name: string; value_numeric: string; unit: string | null; period: string }[];
  actions: { title: string; owner: string | null; due_date: string | null; status: string }[];
  exit: { primary_path: string; alternative_paths: string[]; target_window: string | null; valuation_note: string | null; return_note: string | null; status: string } | null;
}) {
  const lines = [`# ${input.projectName} · ${TEMPLATE_LABELS[input.templateKey] ?? "投后报告"}`, ""];
  if (input.period) lines.push(`报告期：${input.period}`, "");
  lines.push("## 一、项目概况", "", "本报告基于项目材料、投后更新、会议记录和结构化管理信息整理，正式对外使用前请完成内部复核。", "");
  lines.push("## 二、本期经营与重大事项", "");
  if (input.updates.length === 0) lines.push("本期暂无投后更新记录。", "");
  else input.updates.slice(0, 12).forEach((item) => lines.push(`- 【${item.update_type}】${item.period ? `${item.period}：` : ""}${firstSentence(item.content)}`));
  lines.push("", "## 三、关键指标", "");
  if (input.metrics.length === 0) lines.push("暂无已确认的结构化指标。", "");
  else input.metrics.slice(0, 20).forEach((item) => lines.push(`- ${item.metric_name}：${item.value_numeric}${item.unit ? ` ${item.unit}` : ""}（${item.period}）`));
  lines.push("", "## 四、风险与待办", "");
  const risks = input.updates.filter((item) => item.update_type === "risk");
  if (risks.length === 0) lines.push("暂无单独记录的风险事项。", "");
  else risks.slice(0, 8).forEach((item) => lines.push(`- ${firstSentence(item.content)}`));
  if (input.actions.length > 0) {
    lines.push("", "行动项：");
    input.actions.slice(0, 12).forEach((item) => lines.push(`- [${item.status}] ${item.title}${item.owner ? `｜负责人：${item.owner}` : ""}${item.due_date ? `｜截止：${item.due_date}` : ""}`));
  }
  lines.push("", "## 五、退出策略", "");
  if (!input.exit) lines.push("尚未建立独立退出策略记录。", "");
  else {
    lines.push(`- 当前状态：${input.exit.status}`, `- 主要路径：${input.exit.primary_path}`);
    if (input.exit.alternative_paths.length > 0) lines.push(`- 备选路径：${input.exit.alternative_paths.join("、")}`);
    if (input.exit.target_window) lines.push(`- 目标窗口：${input.exit.target_window}`);
    if (input.exit.valuation_note) lines.push(`- 估值判断：${input.exit.valuation_note}`);
    if (input.exit.return_note) lines.push(`- 回报判断：${input.exit.return_note}`);
  }
  lines.push("", "## 六、下期重点", "", "请结合行动项、指标变化和退出窗口，在内部复核后补充下期重点。", "");
  return lines.join("\n");
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    try { await assertProjectAccess(scope, params.id, "read"); } catch (e) { return accessErrorResponse(e); }
    const child = scopedProjectChildWhere(scope, 2, { alias: "r" });
    const rows = await query<ReportRow>(
      `SELECT r.id, r.title, r.content, r.status, m.template_key, m.review_status,
              m.period_start, m.period_end, r.updated_at,
              (SELECT COUNT(*) FROM post_investment_report_exports e WHERE e.report_id = r.id) AS export_count
         FROM reports r
         JOIN post_investment_report_meta m ON m.report_id = r.id
        WHERE r.project_id = $1 AND r.kind = 'post_investment' AND ${child.sql}
        ORDER BY r.updated_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ reports: rows });
  } catch (e) {
    console.error("[post-reports] GET 失败:", e);
    return NextResponse.json({ error: "读取投后报告失败" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    let orgId: string | null = null;
    try { orgId = (await assertProjectAccess(scope, params.id, "write")).orgId; } catch (e) { return accessErrorResponse(e); }
    const body = (await req.json()) as { template_key?: string; period_start?: string; period_end?: string };
    const templateKey = ["internal_review", "lp_update", "assoc_update"].includes(body.template_key ?? "") ? body.template_key! : "internal_review";
    const [projectRows, updates, metrics, actions, exits] = await Promise.all([
      query<{ name: string }>("SELECT name FROM projects WHERE id = $1", [params.id]),
      query<{ update_type: string; content: string; period: string | null }>("SELECT update_type, content, period FROM post_investment_updates WHERE project_id = $1 ORDER BY created_at DESC LIMIT 30", [params.id]),
      query<{ metric_name: string; value_numeric: string; unit: string | null; period: string }>("SELECT metric_name, value_numeric, unit, period FROM post_investment_metrics WHERE project_id = $1 ORDER BY created_at DESC LIMIT 30", [params.id]),
      query<{ title: string; owner: string | null; due_date: string | null; status: string }>("SELECT title, owner, due_date, status FROM post_investment_action_items WHERE project_id = $1 ORDER BY due_date ASC NULLS LAST LIMIT 30", [params.id]),
      query<{ primary_path: string; alternative_paths: string[]; target_window: string | null; valuation_note: string | null; return_note: string | null; status: string }>("SELECT primary_path, alternative_paths, target_window, valuation_note, return_note, status FROM post_investment_exit_strategies WHERE project_id = $1 LIMIT 1", [params.id]),
    ]);
    if (projectRows.length === 0) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const content = buildMarkdown({ projectName: projectRows[0].name, templateKey, period: body.period_start && body.period_end ? `${body.period_start} 至 ${body.period_end}` : null, updates, metrics, actions, exit: exits[0] ?? null });
    const created = await query<{ id: string }>(
      `INSERT INTO reports (project_id, user_id, org_id, title, content, status, kind)
       VALUES ($1, $2, $3, $4, $5, 'draft', 'post_investment') RETURNING id`,
      [params.id, session.user.id, orgId, `${projectRows[0].name} · ${TEMPLATE_LABELS[templateKey]}`, content]
    );
    await query(
      `INSERT INTO post_investment_report_meta (report_id, template_key, period_start, period_end)
       VALUES ($1, $2, $3, $4)`,
      [created[0].id, templateKey, body.period_start || null, body.period_end || null]
    );
    return NextResponse.json({ reportId: created[0].id }, { status: 201 });
  } catch (e) {
    console.error("[post-reports] POST 失败:", e);
    return NextResponse.json({ error: "生成投后报告失败" }, { status: 500 });
  }
}
