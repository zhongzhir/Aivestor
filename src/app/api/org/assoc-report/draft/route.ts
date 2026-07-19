import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireOrgAPI, hasCapability } from "@/lib/orgAuth";
import { buildFormalDocxBuffer } from "@/lib/formal-report/docx";
import { FORMAL_REPORT_PROFILES } from "@/lib/formal-report/profiles";
import { STAGE_LABELS } from "@/lib/stages";

const DISCLAIMER =
  "> 本内容为内部底稿，正式报送以 AMBERS 系统填报为准。AMBERS 字段级对照需后续专项调研，本底稿仅做信息聚合与章节占位。";

const STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
};

// 组装协会报告底稿 Markdown（非 AI，纯模板拼装；架构 7.4）。
function buildDraft(
  org: { name: string; description: string | null; created_at: string | null },
  invested: {
    name: string;
    industry: string | null;
    stage: string | null;
    status: string;
  }[]
): string {
  const lines: string[] = [];
  lines.push(`# ${org.name} · 协会报告底稿`);
  lines.push("");
  lines.push(DISCLAIMER);
  lines.push("");

  // 一、管理人基本情况
  lines.push("## 一、管理人基本情况");
  lines.push("");
  lines.push(`- 管理人名称：${org.name}`);
  lines.push(
    `- 录入时间：${
      org.created_at
        ? new Date(org.created_at).toLocaleDateString("zh-CN")
        : "—"
    }`
  );
  lines.push(`- 机构简介：${org.description?.trim() || "（待维护：请在组织设置中完善机构简介）"}`);
  lines.push("");

  // 二、在管基金（本期以组织简介中人工维护文本代替）
  lines.push("## 二、在管基金");
  lines.push("");
  lines.push(
    "本期暂无基金实体数据结构，以下内容取自组织简介中人工维护的说明文本，供填报参考："
  );
  lines.push("");
  lines.push(
    org.description?.trim()
      ? `> ${org.description.trim()}`
      : "> （待维护：请在组织设置的机构简介中补充在管基金信息）"
  );
  lines.push("");

  // 三、投资项目清单（org 内 status='invested'）
  lines.push("## 三、投资项目清单");
  lines.push("");
  if (invested.length === 0) {
    lines.push("本期无已投项目记录。");
  } else {
    lines.push(`截至目前共 ${invested.length} 个在投项目：`);
    lines.push("");
    for (const p of invested) {
      const stage = p.stage ? STAGE_LABELS[p.stage] ?? p.stage : "未标注";
      lines.push(
        `- **${p.name}**｜赛道：${p.industry ?? "未标注"}｜阶段：${stage}｜状态：${STATUS_LABEL[p.status] ?? p.status}`
      );
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(DISCLAIMER.replace(/^> /, ""));
  lines.push("");

  return lines.join("\n");
}

// GET /api/org/assoc-report/draft — 协会报告底稿。admin + 能力位 assoc_report。
// 默认返回 JSON { markdown }；?format=docx 返回 Word 文档（复用 docx 导出链路）。
export async function GET(req: NextRequest) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  if (!(await hasCapability(ctx.orgId, "assoc_report"))) {
    return NextResponse.json({ error: "组织未开通协会报告能力" }, { status: 403 });
  }

  const [orgRows, invested] = await Promise.all([
    query<{ name: string; description: string | null; created_at: string | null }>(
      "SELECT name, description, created_at FROM orgs WHERE id = $1",
      [ctx.orgId]
    ),
    query<{
      name: string;
      industry: string | null;
      stage: string | null;
      status: string;
    }>(
      `SELECT name, industry, stage, status FROM projects
        WHERE org_id = $1 AND deleted_at IS NULL AND status = 'invested'
        ORDER BY name ASC`,
      [ctx.orgId]
    ),
  ]);

  const org = orgRows[0] ?? {
    name: ctx.orgName,
    description: null,
    created_at: null,
  };
  const markdown = buildDraft(org, invested);

  const format = req.nextUrl.searchParams.get("format");
  if (format === "docx") {
    const buffer = await buildFormalDocxBuffer({
      profile: FORMAL_REPORT_PROFILES.association,
      metadata: {
        title: `${org.name} · 协会报告底稿`,
        organizationName: org.name,
        reportDate: new Date(),
      },
      markdown,
    });
    const filename = encodeURIComponent(
      `协会报告底稿_${org.name}_${new Date().toISOString().slice(0, 10)}.docx`
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  }

  return NextResponse.json({ markdown });
}
