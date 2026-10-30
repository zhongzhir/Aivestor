import { parseFormalReportMarkdown } from "@/lib/formal-report/markdown";

export interface DeepResearchP0Item {
  label: string;
  detail: string;
}

const P0_LABELS: Array<[RegExp, string]> = [
  [/营业执照|统一社会信用代码|法定主体|工商档案/, "主体证照与穿透"],
  [/股权|股东名册|最终受益人|董事会|关联交易|cap\s*table|期权池/i, "股权与关联关系"],
  [/审计|管理报表|总账|纳税|财务|收入台账/, "财务与审计"],
  [/客户|合同|中标|验收|回款|复购|收入质量/, "客户与收入"],
  [/产品测试|测试报告|BOM|ODM|认证|良率|出货|退货|保修|供应链/i, "产品测试与供应链"],
  [/模型|算法|训练数据|数据授权|备案|token/i, "模型算法与数据授权"],
];

function cleanCell(value: string): string {
  return value
    .replace(/\[src:(?:doc|data|ai|external|gap|inconsistent)\]/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function p0Label(detail: string): string {
  return P0_LABELS.find(([pattern]) => pattern.test(detail))?.[1]
    ?? cleanCell(detail.split(/[；;：:]/, 1)[0] ?? "P0门禁").slice(0, 18)
    ?? "P0门禁";
}

export function extractDeepResearchP0Items(markdown: string): DeepResearchP0Item[] {
  const grouped = new Map<string, string[]>();
  for (const block of parseFormalReportMarkdown(markdown)) {
    if (block.type !== "table") continue;
    for (const row of block.rows.slice(1)) {
      const [level = "", ...cells] = row.map(cleanCell);
      if (!/^P0\b/i.test(level)) continue;
      const detail = cells.filter(Boolean).join("；");
      if (!detail) continue;
      const label = p0Label(detail);
      const values = grouped.get(label) ?? [];
      if (!values.includes(detail)) values.push(detail);
      grouped.set(label, values);
    }
  }
  return [...grouped.entries()].slice(0, 6).map(([label, details]) => ({
    label,
    detail: details.slice(0, 2).join("；"),
  }));
}

export function normalizeDeepResearchExportMarkdown(markdown: string): string {
  const p0Items = extractDeepResearchP0Items(markdown);
  let normalized = markdown
    .replace(
      /^[ \t]*(?:[-*+]\s+)?(?:\*\*)?为什么必须暂缓[：:]?(?:\*\*)?[ \t]*$/gm,
      ""
    )
    .replace(
      /未另行执行公开检索[、，]\s*工商司法核验[、，]\s*客户访谈[、，]\s*技术测试或付费数据库查询/g,
      "未开展额外人工检索；本次仅复用系统已保存的外部取证，未另行执行工商司法核验、客户访谈、技术测试或付费数据库查询"
    );

  if (p0Items.length) {
    const summary = p0Items.map((item) => item.label).join("、");
    normalized = normalized.replace(
      /先完成[^。；\n]{0,120}?(?:[一二三四五六七八九十\d]+)项\s*P0\s*核验/g,
      `先完成${summary}${p0Items.length}类P0门禁核验`
    );
  }

  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}
