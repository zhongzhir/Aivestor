import { parseFormalReportMarkdown } from "@/lib/formal-report/markdown";
import type {
  FormalReportBlock,
  FormalReportMetadata,
  FormalReportProfile,
  FormalReportProfileKey,
} from "@/lib/formal-report/types";

type SectionKey =
  | "executive"
  | "overview"
  | "highlights"
  | "financials"
  | "transaction"
  | "performance"
  | "portfolio"
  | "events"
  | "operations"
  | "risks"
  | "recommendation"
  | "diligence"
  | "actions"
  | "exit"
  | "outlook"
  | "appendix";

interface SourceChunk {
  heading?: Extract<FormalReportBlock, { type: "heading" }>;
  blocks: FormalReportBlock[];
  sourceIndex: number;
}

interface TemplateSection {
  key: SectionKey;
  title: string;
  required?: boolean;
}

export interface FormalReportComposition {
  markdown: string;
  applied: true;
  profileKey: FormalReportProfileKey;
  populatedSections: SectionKey[];
  missingSections: Array<{ key: SectionKey; title: string }>;
}

const SECTION_PATTERNS: Array<[SectionKey, RegExp]> = [
  ["diligence", /(尽调|待核验|待验证|数据缺口|信息缺失|问题清单|核查事项)/i],
  ["transaction", /(交易方案|交易结构|投资方案|投资金额|持股比例|交割|条款|term\s*sheet)/i],
  ["financials", /(财务|营收|收入|利润|毛利|现金流|估值|回报测算|收益测算|单位经济)/i],
  ["risks", /(风险|劣势|威胁|挑战|weakness|threat|不确定性|隐患)/i],
  ["highlights", /(投资亮点|核心亮点|优势|机会|strength|opportunit|投资逻辑|增长驱动|护城河)/i],
  ["performance", /(基金业绩|基金表现|收益表现|dpi|tvpi|irr|moic|实缴|缴款|分配)/i],
  ["portfolio", /(投资组合|组合概览|被投企业|项目组合|portfolio)/i],
  ["events", /(重大事项|重要事项|关键事件|本期变化|融资进展)/i],
  ["operations", /(经营情况|经营进展|业务进展|运营情况|经营指标|预算执行)/i],
  ["actions", /(投后动作|行动项|后续动作|责任人|跟进计划|整改计划)/i],
  ["exit", /(退出策略|退出路径|退出安排|上市计划|并购退出)/i],
  ["outlook", /(后续展望|市场展望|下期计划|未来计划|下一阶段)/i],
  ["recommendation", /(投资建议|初步判断|投资结论|决策事项|决策建议|战略建议|行动建议|应该做什么|应该避免什么)/i],
  ["overview", /(项目概览|项目概况|公司概况|基本情况|项目背景|基金概览|报告概览)/i],
  ["executive", /(执行摘要|核心判断|核心观点|核心结论|摘要|结论概览|核心分析视角)/i],
];

const TEMPLATES: Record<FormalReportProfileKey, TemplateSection[]> = {
  project_initiation: [
    { key: "executive", title: "执行摘要", required: true },
    { key: "overview", title: "项目概览", required: true },
    { key: "highlights", title: "投资亮点与机会", required: true },
    { key: "financials", title: "商业模式与财务关注", required: true },
    { key: "risks", title: "核心风险与不确定性", required: true },
    { key: "recommendation", title: "初步判断与立项建议", required: true },
    { key: "diligence", title: "尽调重点与待核验事项", required: true },
  ],
  investment_committee: [
    { key: "executive", title: "执行摘要与决策事项", required: true },
    { key: "overview", title: "项目概览", required: true },
    { key: "highlights", title: "投资逻辑", required: true },
    { key: "financials", title: "财务、估值与回报测算", required: true },
    { key: "transaction", title: "交易方案与核心条款", required: true },
    { key: "risks", title: "核心风险与控制措施", required: true },
    { key: "recommendation", title: "投资建议与表决事项", required: true },
    { key: "diligence", title: "待核验事项与交割条件", required: true },
  ],
  lp: [
    { key: "executive", title: "报告摘要", required: true },
    { key: "overview", title: "基金概览", required: true },
    { key: "performance", title: "基金表现与收益指标", required: true },
    { key: "portfolio", title: "投资组合进展", required: true },
    { key: "events", title: "本期重大事项", required: true },
    { key: "risks", title: "风险事项与披露", required: true },
    { key: "outlook", title: "后续计划与展望", required: true },
  ],
  post_investment: [
    { key: "executive", title: "投后摘要", required: true },
    { key: "overview", title: "项目与报告周期概览", required: true },
    { key: "operations", title: "经营进展与关键指标", required: true },
    { key: "events", title: "重大事项与融资进展", required: true },
    { key: "risks", title: "风险预警与偏差分析", required: true },
    { key: "actions", title: "投后行动项", required: true },
    { key: "exit", title: "退出路径与回报展望", required: true },
  ],
  association: [
    { key: "executive", title: "报送摘要", required: true },
    { key: "overview", title: "主体概览", required: true },
    { key: "highlights", title: "核心进展与行业价值", required: true },
    { key: "events", title: "重点事项", required: true },
    { key: "outlook", title: "后续计划", required: true },
  ],
  general: [
    { key: "executive", title: "执行摘要", required: true },
    { key: "overview", title: "报告概览", required: true },
    { key: "highlights", title: "核心发现", required: true },
    { key: "risks", title: "风险与限制", required: true },
    { key: "recommendation", title: "结论与建议", required: true },
  ],
};

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, "$1")
    .trim();
}

function blocksToChunks(blocks: FormalReportBlock[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let current: SourceChunk = { blocks: [], sourceIndex: 0 };

  const flush = () => {
    if (current.heading || current.blocks.length) chunks.push(current);
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flush();
      current = { heading: block, blocks: [], sourceIndex: chunks.length };
    } else if (block.type !== "divider") {
      current.blocks.push(block);
    }
  }
  flush();
  return chunks;
}

function isDocumentTitle(chunk: SourceChunk, metadata: FormalReportMetadata): boolean {
  if (!chunk.heading) return false;
  const text = plainText(chunk.heading.text);
  const projectName = plainText(metadata.projectName ?? "");
  return (
    chunk.heading.level === 1 &&
    /(报告|分析|SWOT|memo|备忘录)/i.test(text) &&
    (!projectName || text.includes(projectName))
  );
}

function chunkSearchText(chunk: SourceChunk): string {
  const heading = chunk.heading ? plainText(chunk.heading.text) : "";
  const body = chunk.blocks
    .slice(0, 2)
    .map((block) => ("text" in block ? plainText(block.text) : ""))
    .join(" ");
  return `${heading} ${body}`;
}

function classifyChunk(
  chunk: SourceChunk,
  metadata: FormalReportMetadata,
  profileKey: FormalReportProfileKey
): SectionKey {
  if (isDocumentTitle(chunk, metadata)) return "executive";

  const headingText = chunk.heading ? plainText(chunk.heading.text) : "";
  if (headingText) {
    if (
      profileKey === "investment_committee" &&
      /^(投资结论|决策结论|表决事项|决策事项|上会结论)/i.test(headingText)
    ) {
      return "executive";
    }
    for (const [key, pattern] of SECTION_PATTERNS) {
      if (pattern.test(headingText)) return key;
    }
  }

  const text = chunkSearchText(chunk);
  for (const [key, pattern] of SECTION_PATTERNS) {
    if (pattern.test(text)) return key;
  }
  if (!chunk.heading) return "executive";
  return "appendix";
}

function serializeBlock(block: FormalReportBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${plainText(block.text)}`;
    case "paragraph":
      return block.text;
    case "bullet":
      return `${"  ".repeat(block.level)}- ${block.text}`;
    case "number":
      return `${"  ".repeat(block.level)}${block.ordinal ?? "1"}. ${block.text}`;
    case "quote":
      return `> ${block.text}`;
    case "table": {
      if (!block.rows.length) return "";
      const [header, ...rows] = block.rows;
      return [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }
    case "divider":
      return "---";
  }
}

function serializeChunk(
  chunk: SourceChunk,
  metadata: FormalReportMetadata
): string {
  const parts: string[] = [];
  if (chunk.heading && !isDocumentTitle(chunk, metadata)) {
    parts.push(`## ${plainText(chunk.heading.text)}`);
  }
  parts.push(...chunk.blocks.map(serializeBlock).filter(Boolean));
  return parts.join("\n\n").trim();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function overviewMarkdown(
  profile: FormalReportProfile,
  metadata: FormalReportMetadata
): string {
  const subjectLabel = profile.key === "lp" ? "报告主体" : "项目名称";
  return [
    `| 项目 | 信息 |`,
    `| --- | --- |`,
    `| ${subjectLabel} | ${plainText(metadata.projectName || metadata.title)} |`,
    `| 报告类型 | ${profile.label} |`,
    metadata.organizationName
      ? `| 出具机构 | ${plainText(metadata.organizationName)} |`
      : "",
    metadata.industry ? `| 所属行业 | ${plainText(metadata.industry)} |` : "",
    metadata.stage ? `| 当前阶段 | ${plainText(metadata.stage)} |` : "",
    `| 出具日期 | ${formatDate(metadata.reportDate)} |`,
    metadata.version != null ? `| 报告版本 | V${metadata.version} |` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function missingItem(section: TemplateSection): string {
  return `- **${section.title}**：现有报告未形成可直接用于正式提交的充分内容，请经办人在报送前补充或复核。`;
}

export function composeFormalReport(input: {
  markdown: string;
  profile: FormalReportProfile;
  metadata: FormalReportMetadata;
}): FormalReportComposition {
  const blocks = parseFormalReportMarkdown(input.markdown);
  const chunks = blocksToChunks(blocks);
  const template = TEMPLATES[input.profile.key];
  const grouped = new Map<SectionKey, SourceChunk[]>();

  for (const chunk of chunks) {
    if (!chunk.heading && !chunk.blocks.length) continue;
    const key = classifyChunk(chunk, input.metadata, input.profile.key);
    grouped.set(key, [...(grouped.get(key) ?? []), chunk]);
  }

  const output: string[] = [];
  const populatedSections: SectionKey[] = [];
  const missingSections: Array<{ key: SectionKey; title: string }> = [];

  for (const section of template) {
    let content = "";
    if (section.key === "overview") {
      const source = grouped.get("overview") ?? [];
      content = [
        overviewMarkdown(input.profile, input.metadata),
        ...source.map((chunk) => serializeChunk(chunk, input.metadata)),
      ]
        .filter(Boolean)
        .join("\n\n");
      grouped.delete("overview");
    } else {
      const source = grouped.get(section.key) ?? [];
      content = source
        .map((chunk) => serializeChunk(chunk, input.metadata))
        .filter(Boolean)
        .join("\n\n");
      grouped.delete(section.key);
    }

    if (content) {
      output.push(`# ${section.title}\n\n${content}`);
      populatedSections.push(section.key);
    } else if (section.required) {
      missingSections.push({ key: section.key, title: section.title });
    }
  }

  const remaining = Array.from(grouped.values())
    .flat()
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((chunk) => serializeChunk(chunk, input.metadata))
    .filter(Boolean);
  if (remaining.length) {
    output.push(`# 补充分析与依据\n\n${remaining.join("\n\n")}`);
    populatedSections.push("appendix");
  }

  if (missingSections.length) {
    output.push(
      [
        "# 待补充与核验事项",
        "",
        "> 以下内容仅提示现有报告的信息缺口，不代表相关事项不存在。正式提交前应由经办人结合底稿补充并复核。",
        "",
        ...missingSections.map(missingItem),
      ].join("\n")
    );
  }

  return {
    markdown: output.join("\n\n").trim(),
    applied: true,
    profileKey: input.profile.key,
    populatedSections,
    missingSections,
  };
}
