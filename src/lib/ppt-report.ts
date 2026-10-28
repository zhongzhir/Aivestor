import path from "node:path";
import { existsSync } from "node:fs";
import pptxgen from "pptxgenjs";
import { parseFormalReportMarkdown } from "@/lib/formal-report/markdown";
import type { FormalReportBlock } from "@/lib/formal-report/types";
import type { BrandConfig } from "@/lib/brand";
import { stripActualHtmlTags } from "@/lib/reportText";
import type { FinancialData } from "@/lib/types";

const WHITE = "FFFFFF";
const INK = "1F2937";
const INK_SOFT = "4B5563";
const LINE = "E5E7EB";
const CARD_BG = "F4F5F7";
const CONTENT_X = 0.72;
const CONTENT_W = 11.9;
const CONTENT_TOP = 1.82;
const CONTENT_LINES = 17;

export interface PptReportMetadata {
  title: string;
  projectName: string;
  industry?: string | null;
  stage?: string | null;
  reportDate: Date;
}

interface PptSection {
  title: string;
  blocks: FormalReportBlock[];
}

export interface PptReportBuildInput {
  markdown: string;
  metadata: PptReportMetadata;
  brand: BrandConfig;
  mode?: "full" | "deep_research_ic";
  financialData?: FinancialData | null;
}

function plain(text: string): string {
  return stripActualHtmlTags(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/\[src:(?:doc|data|ai|external|gap|inconsistent)\]/g, "")
    .trim();
}

function splitLongText(text: string, maxChars: number): string[] {
  const clean = plain(text);
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[。！？；;.!?])\s*/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences.length ? sentences : [clean]) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitTableCell(text: string, maxChars: number): string {
  const clean = plain(text);
  if (clean.length <= maxChars) return clean;
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += maxChars) {
    lines.push(clean.slice(i, i + maxChars));
  }
  return lines.join("\n");
}

function tableCellLines(text: string): number {
  return plain(text)
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 24)), 0);
}

function tableRowLines(row: string[]): number {
  return Math.max(1, ...row.map(tableCellLines));
}

function estimateLines(block: FormalReportBlock): number {
  switch (block.type) {
    case "heading":
      return block.level === 1 ? 2 : 1.5;
    case "table":
      return Math.max(
        2,
        block.rows.reduce(
          (sum, row) =>
            sum +
            Math.max(2, Math.ceil(tableRowLines(row) * 0.22 / 0.24)),
          0
        ) + 1
      );
    case "bullet":
    case "number":
      return Math.max(1, Math.ceil(plain(block.text).length / 28));
    case "quote":
    case "paragraph":
      return Math.max(1, Math.ceil(plain(block.text).length / 44));
    case "divider":
      return 0.5;
  }
}

function expandBlocks(blocks: FormalReportBlock[]): FormalReportBlock[] {
  const result: FormalReportBlock[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "quote") {
      for (const chunk of splitLongText(block.text, block.type === "quote" ? 190 : 260)) {
        result.push({ ...block, text: chunk });
      }
      continue;
    }
    if (block.type === "bullet" || block.type === "number") {
      for (const chunk of splitLongText(block.text, 120)) {
        result.push({ ...block, text: chunk });
      }
      continue;
    }
    if (block.type === "table") {
      const [header, ...body] = block.rows;
      const groups: string[][][] = [];
      let group: string[][] = [];
      let groupLines = 0;
      for (const row of body) {
        const prepared = row.map((cell) =>
          splitTableCell(cell, block.rows[0]?.length >= 5 ? 16 : 24)
        );
        const rowLines = tableRowLines(prepared);
        if (group.length && groupLines + rowLines > 10) {
          groups.push(group);
          group = [];
          groupLines = 0;
        }
        group.push(prepared);
        groupLines += rowLines;
      }
      if (group.length || groups.length === 0) groups.push(group);
      for (const rows of groups) {
        result.push({
          type: "table",
          rows: [header, ...rows],
        });
      }
      continue;
    }
    result.push(block);
  }
  return result;
}

export function parsePptSections(markdown: string): PptSection[] {
  const sections: PptSection[] = [];
  let current: PptSection | null = null;
  for (const block of parseFormalReportMarkdown(markdown)) {
    if (block.type === "heading" && block.level === 1) {
      current = { title: plain(block.text), blocks: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { title: "概述", blocks: [] };
        sections.push(current);
      }
      current.blocks.push(block);
    }
  }
  return sections
    .map((section) => ({ ...section, blocks: expandBlocks(section.blocks) }))
    .filter((section) => section.blocks.length > 0);
}

function assetPath(asset: string): string {
  return path.resolve(process.cwd(), "public", asset.replace(/^\//, ""));
}

function addFooter(pptx: pptxgen, slide: pptxgen.Slide, brand: BrandConfig, date: string) {
  slide.addShape(pptx.ShapeType.line, {
    x: CONTENT_X,
    y: 6.92,
    w: CONTENT_W,
    h: 0,
    line: { color: LINE, width: 0.7 },
  });
  slide.addText(`${brand.productName}  ·  ${date}`, {
    x: CONTENT_X,
    y: 7.02,
    w: CONTENT_W,
    h: 0.22,
    fontSize: 8.5,
    color: "8993A4",
    margin: 0,
    align: "right",
  });
}

function addBrandLogo(
  slide: pptxgen.Slide,
  brand: BrandConfig,
  reverse = false
) {
  const logo = assetPath(reverse ? brand.assets.logoReverse : brand.assets.logo);
  if (!existsSync(logo)) {
    slide.addText(brand.englishName, {
      x: CONTENT_X,
      y: 0.48,
      w: 4.8,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: reverse ? brand.colors.accent.replace("#", "") : brand.colors.deep.replace("#", ""),
      charSpacing: 1.5,
      margin: 0,
    });
    return;
  }
  try {
    slide.addImage({
      path: logo,
      x: CONTENT_X,
      y: 0.38,
      w: 2.4,
      h: 0.52,
      transparency: 0,
    });
  } catch {
    slide.addText(brand.englishName, {
      x: CONTENT_X,
      y: 0.48,
      w: 4.8,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: reverse ? brand.colors.accent.replace("#", "") : brand.colors.deep.replace("#", ""),
      charSpacing: 1.5,
      margin: 0,
    });
  }
}

function addHeader(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  title: string,
  brand: BrandConfig,
  date: string,
  continuation: boolean
) {
  slide.background = { color: WHITE };
  addBrandLogo(slide, brand);
  slide.addText(continuation ? `${title}（续）` : title, {
    x: CONTENT_X,
    y: 0.92,
    w: CONTENT_W,
    h: 0.62,
    fontSize: 25,
    bold: true,
    color: brand.colors.deep.replace("#", ""),
    margin: 0,
    fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: CONTENT_X,
    y: 1.62,
    w: CONTENT_W,
    h: 0,
    line: { color: LINE, width: 1 },
  });
  addFooter(pptx, slide, brand, date);
}

function addTextBlock(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  block: FormalReportBlock,
  y: number
): number {
  const lines = estimateLines(block);
  const lineHeight = block.type === "paragraph" || block.type === "quote" ? 0.23 : 0.28;
  const h = Math.max(0.28, Math.min(4.3, lines * lineHeight));
  if (block.type === "heading") {
    slide.addText(plain(block.text), {
      x: CONTENT_X,
      y,
      w: CONTENT_W,
      h,
      fontSize: block.level === 2 ? 18 : 14,
      bold: true,
      color: block.level === 2 ? "245A9A" : INK,
      margin: 0,
      fit: "shrink",
    });
  } else if (block.type === "quote") {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: CONTENT_X,
      y,
      w: CONTENT_W,
      h,
      fill: { color: "FFF6DF" },
      line: { color: "F2D59A", width: 0.8 },
      rectRadius: 0.06,
    });
    slide.addText(plain(block.text), {
      x: CONTENT_X + 0.2,
      y: y + 0.06,
      w: CONTENT_W - 0.4,
      h: h - 0.12,
      fontSize: 13,
      color: "8A5A12",
      margin: 0,
      fit: "shrink",
      valign: "middle",
    });
  } else if (block.type === "paragraph" || block.type === "bullet" || block.type === "number") {
    const prefix =
      block.type === "bullet"
        ? "• "
        : block.type === "number"
          ? `${block.ordinal ?? ""}. `
          : "";
    slide.addText(`${prefix}${plain(block.text)}`, {
      x: CONTENT_X + (block.type === "bullet" || block.type === "number" ? 0.14 : 0),
      y,
      w: CONTENT_W - (block.type === "bullet" || block.type === "number" ? 0.14 : 0),
      h,
      fontSize: block.type === "paragraph" ? 14 : 13,
      color: block.type === "paragraph" ? INK_SOFT : INK,
      margin: 0,
      breakLine: false,
      fit: "shrink",
      valign: "top",
    });
  } else {
    slide.addShape(pptx.ShapeType.line, {
      x: CONTENT_X,
      y: y + 0.1,
      w: CONTENT_W,
      h: 0,
      line: { color: LINE, width: 0.8 },
    });
  }
  return y + h + 0.12;
}

function addTableBlock(
  slide: pptxgen.Slide,
  block: Extract<FormalReportBlock, { type: "table" }>,
  y: number
) {
  const columns = Math.max(1, ...block.rows.map((row) => row.length));
  const fontSize = columns >= 6 ? 8.5 : columns >= 4 ? 10 : 11;
  const rows = block.rows.map((row, rowIndex) =>
    Array.from({ length: columns }, (_, index) => ({
      text: row[index] ?? "",
      options: {
        bold: rowIndex === 0,
        color: rowIndex === 0 ? WHITE : INK,
        fill: {
          color: rowIndex === 0 ? "0D1B3E" : rowIndex % 2 === 0 ? "F7F8FA" : WHITE,
        },
        breakLine: false,
        margin: 0.08,
        valign: "middle" as const,
      },
    }))
  );
  const rowHeights = block.rows.map((row, rowIndex) => {
    const lines = tableRowLines(row);
    const base = columns >= 4 || rowIndex === 0 ? 0.58 : 0.46;
    return Math.max(base, Math.min(2.4, lines * 0.22));
  });
  const estimated = Math.max(0.75, rowHeights.reduce((sum, height) => sum + height, 0));
  slide.addTable(rows, {
    x: CONTENT_X,
    y,
    w: CONTENT_W,
    h: estimated,
    border: { type: "solid", color: LINE, pt: 0.6 },
    color: INK,
    fontFace: "Microsoft YaHei",
    fontSize,
    margin: 0.08,
    valign: "middle",
    rowH: rowHeights,
  });
  return y + estimated + 0.16;
}

function addContentSlide(
  pptx: pptxgen,
  section: PptSection,
  blocks: FormalReportBlock[],
  brand: BrandConfig,
  date: string,
  continuation: boolean
) {
  const slide = pptx.addSlide();
  addHeader(pptx, slide, section.title, brand, date, continuation);
  let y = CONTENT_TOP;
  for (const block of blocks) {
    if (block.type === "table") y = addTableBlock(slide, block, y);
    else y = addTextBlock(pptx, slide, block, y);
  }
  return slide;
}

interface IcSlideSpec {
  title: string;
  patterns: RegExp[];
  fallback: string;
  visual?: "evidence" | "financial" | "decision";
}

const IC_SLIDES: IcSlideSpec[] = [
  { title: "投资结论与核心判断", patterns: [/执行摘要|综合评级|投资建议|综合研判/], fallback: "报告尚未形成可直接上会的结论摘要。", visual: "decision" },
  { title: "证据成熟度与研究边界", patterns: [/研究身份|证据分级|数据来源|重要声明/], fallback: "证据成熟度需结合来源索引与质量门禁复核。", visual: "evidence" },
  { title: "公司、产品与技术", patterns: [/公司概览|核心产品|技术|业务架构/], fallback: "公司与产品事实仍需补充可定位材料。" },
  { title: "商业化、客户与收入证据", patterns: [/客户|市场|商业化|商业模型|上下游/], fallback: "客户、合同、交付、回款与复购证据仍待补充。" },
  { title: "财务趋势与经营质量", patterns: [/财务分析|发展阶段与财务|收入|毛利|现金流/], fallback: "尚未形成可复核的结构化财务趋势。", visual: "financial" },
  { title: "估值参数与敏感性", patterns: [/估值|敏感性|P\/S|EV\/EBITDA|市销率|市盈率|毛利率/], fallback: "估值参数或敏感性尚未形成可复核测算。" },
  { title: "团队与组织能力", patterns: [/核心团队|团队|组织架构|人才缺口/], fallback: "关键人员履历、全职状态和组织能力仍待核验。" },
  { title: "竞争格局与护城河", patterns: [/竞争对手|竞争格局|护城河|第一曲线|第二曲线/], fallback: "竞争对比与可持续壁垒证据仍待补充。" },
  { title: "核心风险与缓释", patterns: [/核心瓶颈|风险缓释|风险提示|负面事实/], fallback: "风险应区分已确认事实、证据缺口与情景推演。" },
  { title: "P0尽调门禁", patterns: [/分级尽调|补充尽调|证据缺口|前置条件/], fallback: "请把会改变投不投、估值、金额、条款或时点的事项列为P0。" },
  { title: "进入方式与退出路径", patterns: [/投资价值|适配度|进入方式|退出|融资历史|机构分析/], fallback: "进入方式、交易参数与退出路径仍待机构参数补齐。" },
  { title: "下一步动作与决策触发器", patterns: [/触发器|行动|下一步|建议验证阈值|综合研判/], fallback: "建议把关键补证任务落实到责任人、时限和升级/否决触发器。", visual: "decision" },
];

function blockToInsight(block: FormalReportBlock): string[] {
  if (block.type === "divider" || block.type === "heading") return [];
  if (block.type === "table") {
    return block.rows.slice(1).map((row) => plain(row.join("："))).filter(Boolean);
  }
  return splitLongText(block.text, 110);
}

function icInsights(markdown: string, spec: IcSlideSpec): string[] {
  const sections = parsePptSections(markdown);
  const preferred = sections.filter((section) =>
    spec.patterns.some((pattern) => pattern.test(section.title))
  );
  const secondary = sections.filter((section) =>
    !preferred.includes(section) &&
    spec.patterns.some((pattern) => pattern.test(section.blocks.map((block) =>
      block.type === "table" ? block.rows.flat().join(" ") : "text" in block ? block.text : ""
    ).join(" ")))
  );
  const seen = new Set<string>();
  const insights: string[] = [];
  for (const section of [...preferred, ...secondary]) {
    for (const value of section.blocks.flatMap(blockToInsight)) {
      const clean = plain(value).replace(/^[-•\d.、\s]+/, "").trim();
      if (clean.length < 8 || seen.has(clean)) continue;
      seen.add(clean);
      insights.push(clean);
      if (insights.length >= 5) return insights;
    }
  }
  return insights.length ? insights : [spec.fallback];
}

function addEvidenceVisual(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  markdown: string,
  brand: BrandConfig
) {
  const items = [
    ["文件依据", (markdown.match(/\[src:doc\]/g) || []).length, "496FA8"],
    ["数据提取", (markdown.match(/\[src:data\]/g) || []).length, "287A5A"],
    ["外部证据", (markdown.match(/\[src:external\]/g) || []).length, "8A5A12"],
    ["待补缺口", (markdown.match(/\[src:gap\]/g) || []).length, "A33A3A"],
  ] as const;
  const max = Math.max(1, ...items.map((item) => item[1]));
  items.forEach(([label, value, color], index) => {
    const y = 4.55 + index * 0.48;
    slide.addText(label, { x: CONTENT_X, y, w: 1.35, h: 0.28, fontSize: 12, color: INK_SOFT, margin: 0 });
    slide.addShape(pptx.ShapeType.rect, { x: 2.15, y: y + 0.02, w: 3.2, h: 0.2, fill: { color: "E9EDF3" }, line: { color: "E9EDF3" } });
    slide.addShape(pptx.ShapeType.rect, { x: 2.15, y: y + 0.02, w: Math.max(0.08, 3.2 * value / max), h: 0.2, fill: { color }, line: { color } });
    slide.addText(String(value), { x: 5.48, y, w: 0.55, h: 0.28, fontSize: 12, bold: true, color: brand.colors.deep.replace("#", ""), margin: 0 });
  });
}

function addFinancialVisual(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  financialData?: FinancialData | null
) {
  const points = (financialData?.revenue || []).slice(-4);
  if (!points.length) return;
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  points.forEach((point, index) => {
    const x = CONTENT_X + index * 1.45;
    const height = Math.max(0.15, 1.15 * Math.abs(point.value) / max);
    slide.addShape(pptx.ShapeType.rect, { x, y: 6.05 - height, w: 0.78, h: height, fill: { color: point.type === "actual" ? "287A5A" : "8BA6C8" }, line: { color: WHITE } });
    slide.addText(`${point.year}${point.type === "forecast" ? "E" : "A"}`, { x: x - 0.15, y: 6.12, w: 1.08, h: 0.25, fontSize: 10, align: "center", margin: 0, color: INK_SOFT });
    slide.addText(String(point.value), { x: x - 0.2, y: 4.68 - height, w: 1.18, h: 0.25, fontSize: 10, align: "center", margin: 0, color: INK });
  });
}

function addIcSlide(
  pptx: pptxgen,
  spec: IcSlideSpec,
  insights: string[],
  input: PptReportBuildInput,
  date: string,
  sourceNotes: string
) {
  const slide = pptx.addSlide();
  addHeader(pptx, slide, spec.title, input.brand, date, false);
  insights.slice(0, 5).forEach((insight, index) => {
    const y = CONTENT_TOP + index * 0.52;
    slide.addShape(pptx.ShapeType.ellipse, { x: CONTENT_X, y: y + 0.1, w: 0.14, h: 0.14, fill: { color: index === 0 ? input.brand.colors.accent.replace("#", "") : "A9B4C6" }, line: { color: WHITE } });
    slide.addText(insight, { x: CONTENT_X + 0.28, y, w: CONTENT_W - 0.28, h: 0.43, fontSize: 18, color: index === 0 ? INK : INK_SOFT, bold: index === 0, margin: 0, fit: "shrink", valign: "middle" });
  });
  if (spec.visual === "evidence") addEvidenceVisual(pptx, slide, input.markdown, input.brand);
  if (spec.visual === "financial") addFinancialVisual(pptx, slide, input.financialData);
  if (spec.visual === "decision") {
    slide.addShape(pptx.ShapeType.roundRect, { x: 7.2, y: 4.75, w: 5.4, h: 1.08, fill: { color: "F4F5F7" }, line: { color: "D9DEE7" }, rectRadius: 0.04 });
    slide.addText("证据补齐  →  参数复核  →  条件触发  →  投资决策", { x: 7.45, y: 5.06, w: 4.9, h: 0.38, fontSize: 17, bold: true, color: input.brand.colors.deep.replace("#", ""), align: "center", margin: 0, fit: "shrink" });
  }
  if (sourceNotes) slide.addNotes(sourceNotes);
}

export async function buildPptReportBuffer(input: PptReportBuildInput): Promise<Buffer> {
  const { metadata, brand } = input;
  const sections = parsePptSections(input.markdown);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = brand.productName;
  pptx.subject = metadata.title;
  pptx.company = brand.legalName;
  const date = metadata.reportDate.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const cover = pptx.addSlide();
  cover.background = { color: brand.colors.deep.replace("#", "") };
  addBrandLogo(cover, brand, true);
  cover.addText(metadata.projectName, {
    x: CONTENT_X,
    y: 2.45,
    w: CONTENT_W,
    h: 1.2,
    fontSize: 42,
    bold: true,
    color: WHITE,
    margin: 0,
    fit: "shrink",
  });
  const meta = [metadata.industry, metadata.stage].filter(Boolean).join("  ·  ");
  if (meta) {
    cover.addText(meta, {
      x: CONTENT_X,
      y: 3.95,
      w: CONTENT_W,
      h: 0.42,
      fontSize: 18,
      color: brand.colors.accent.replace("#", ""),
      margin: 0,
      fit: "shrink",
    });
  }
  cover.addText(metadata.title, {
    x: CONTENT_X,
    y: 4.58,
    w: CONTENT_W,
    h: 0.42,
    fontSize: 15,
    color: "C7D0E0",
    margin: 0,
    fit: "shrink",
  });
  cover.addText(`${brand.productName}  |  ${date}`, {
    x: CONTENT_X,
    y: 6.55,
    w: CONTENT_W,
    h: 0.3,
    fontSize: 11,
    color: "C7D0E0",
    margin: 0,
    align: "right",
  });

  if (input.mode === "deep_research_ic") {
    cover.addText("投委会摘要 · AI生成审核稿", {
      x: CONTENT_X,
      y: 5.22,
      w: CONTENT_W,
      h: 0.38,
      fontSize: 17,
      color: "C7D0E0",
      margin: 0,
    });
    const sourceNotes = Array.from(
      new Set(input.markdown.match(/https?:\/\/[^\s)】]+/g) || [])
    ).slice(0, 40).join("\n");
    for (const spec of IC_SLIDES) {
      addIcSlide(
        pptx,
        spec,
        icInsights(input.markdown, spec),
        input,
        date,
        sourceNotes
      );
    }
    const end = pptx.addSlide();
    end.background = { color: brand.colors.deep.replace("#", "") };
    end.addText("决策建议", {
      x: CONTENT_X,
      y: 2.5,
      w: CONTENT_W,
      h: 0.7,
      fontSize: 40,
      bold: true,
      color: WHITE,
      align: "center",
      margin: 0,
    });
    end.addText("基于已核验证据作出判断 · 将关键缺口转化为可执行尽调任务", {
      x: CONTENT_X,
      y: 3.65,
      w: CONTENT_W,
      h: 0.5,
      fontSize: 18,
      color: brand.colors.accent.replace("#", ""),
      align: "center",
      margin: 0,
    });
    return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  }

  const toc = pptx.addSlide();
  addHeader(pptx, toc, "目录", brand, date, false);
  const tocRows = sections.map((section, index) => `${String(index + 1).padStart(2, "0")}  ${section.title}`);
  const tocChunks: string[][] = [];
  for (let i = 0; i < tocRows.length; i += 8) tocChunks.push(tocRows.slice(i, i + 8));
  // 目录过长时续页，目录条目与后续章节顺序保持一致，不伪造页码。
  for (let page = 0; page < tocChunks.length; page += 1) {
    const target = page === 0 ? toc : pptx.addSlide();
    if (page > 0) addHeader(pptx, target, "目录", brand, date, true);
    target.addText(tocChunks[page].join("\n"), {
      x: CONTENT_X,
      y: CONTENT_TOP,
      w: CONTENT_W,
      h: 4.9,
      fontSize: 18,
      color: INK,
      breakLine: false,
      margin: 0.06,
      fit: "shrink",
      valign: "top",
    });
  }

  for (const section of sections) {
    let pageBlocks: FormalReportBlock[] = [];
    let usedLines = 0;
    let continuation = false;
    const flush = () => {
      if (pageBlocks.length === 0) return;
      addContentSlide(pptx, section, pageBlocks, brand, date, continuation);
      pageBlocks = [];
      usedLines = 0;
      continuation = true;
    };
    for (let index = 0; index < section.blocks.length; index += 1) {
      const block = section.blocks[index];
      const blockLines = estimateLines(block);
      const next = section.blocks[index + 1];
      // 不让二级标题独占新页；与下一块一起进入下一页。
      if (
        pageBlocks.length > 0 &&
        (usedLines + blockLines > CONTENT_LINES ||
          (block.type === "heading" && !next))
      ) {
        flush();
      }
      if (block.type === "heading" && !next && pageBlocks.length === 0) continue;
      pageBlocks.push(block);
      usedLines += blockLines;
    }
    flush();
  }

  const end = pptx.addSlide();
  end.background = { color: brand.colors.deep.replace("#", "") };
  end.addText("感谢审阅", {
    x: CONTENT_X,
    y: 2.9,
    w: CONTENT_W,
    h: 1,
    fontSize: 42,
    bold: true,
    color: WHITE,
    align: "center",
    margin: 0,
  });
  end.addText(brand.productName, {
    x: CONTENT_X,
    y: 4.25,
    w: CONTENT_W,
    h: 0.35,
    fontSize: 15,
    color: brand.colors.accent.replace("#", ""),
    align: "center",
    margin: 0,
  });

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
