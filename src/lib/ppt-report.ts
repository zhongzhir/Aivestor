import path from "node:path";
import pptxgen from "pptxgenjs";
import { parseFormalReportMarkdown } from "@/lib/formal-report/markdown";
import type { FormalReportBlock } from "@/lib/formal-report/types";
import type { BrandConfig } from "@/lib/brand";

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
}

function plain(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*|__/g, "")
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
            Math.max(
              1,
              ...row.map((cell) => Math.ceil(plain(cell).length / 30))
            ),
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
      for (const row of body) {
        group.push(row);
        if (group.length >= 5) {
          groups.push(group);
          group = [];
        }
      }
      if (group.length || groups.length === 0) groups.push(group);
      for (const rows of groups) {
        result.push({
          type: "table",
          rows: [header, ...rows].map((row) =>
            row.map((cell) => splitTableCell(cell, block.rows[0]?.length >= 5 ? 16 : 24))
          ),
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
  try {
    slide.addImage({
      path: assetPath(reverse ? brand.assets.logoReverse : brand.assets.logo),
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
  const rowHeight = columns >= 4 || rows.some((row) => row.some((cell) => cell.text.includes("\n")))
    ? 0.58
    : 0.46;
  const estimated = Math.max(0.75, rows.length * rowHeight);
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
    rowH: rowHeight,
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
