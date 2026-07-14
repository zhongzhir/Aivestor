import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from "docx";
import { parseFormalReportMarkdown } from "@/lib/formal-report/markdown";
import type {
  FormalReportMetadata,
  FormalReportProfile,
} from "@/lib/formal-report/types";

const FONT_BODY = "宋体";
const FONT_HEADING = "微软雅黑";
const COLOR_INK = "1F2937";
const COLOR_MUTED = "667085";
const COLOR_LINE = "D9DEE7";
const COLOR_WHITE = "FFFFFF";
const COLOR_RISK = "9F2D2D";
const COLOR_RISK_SOFT = "FCECEC";
const COLOR_NOTE = "8A5A12";
const COLOR_NOTE_SOFT = "FFF6DF";
const PAGE_WIDTH_DXA = 11906;
const PAGE_HEIGHT_DXA = 16838;
const CONTENT_WIDTH_DXA = 9026;

function plainMarkdown(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .trim();
}

function inlineRuns(
  text: string,
  options?: { color?: string; size?: number; bold?: boolean }
): TextRun[] {
  return plainMarkdown(text)
    .split("**")
    .map(
      (segment, index) =>
        new TextRun({
          text: segment,
          bold: options?.bold || index % 2 === 1,
          color: options?.color ?? COLOR_INK,
          size: options?.size ?? 21,
          font: FONT_BODY,
        })
    );
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: inlineRuns(text),
    spacing: { line: 330, lineRule: LineRuleType.AUTO, after: 150 },
    widowControl: true,
  });
}

function labelValueTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 26, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 80, right: 80 },
              children: [
                new Paragraph({
                  children: inlineRuns(label, {
                    color: COLOR_MUTED,
                    size: 19,
                  }),
                }),
              ],
            }),
            new TableCell({
              width: { size: 74, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 80, right: 80 },
              children: [
                new Paragraph({
                  children: inlineRuns(value, { size: 20, bold: true }),
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function callout(
  text: string,
  profile: FormalReportProfile,
  kind: "decision" | "risk" | "note"
): Table {
  const fill =
    kind === "risk"
      ? COLOR_RISK_SOFT
      : kind === "note"
        ? COLOR_NOTE_SOFT
        : profile.accentSoft;
  const color =
    kind === "risk"
      ? COLOR_RISK
      : kind === "note"
        ? COLOR_NOTE
        : profile.accentDark;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: fill },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: fill },
      left: { style: BorderStyle.SINGLE, size: 16, color },
      right: { style: BorderStyle.SINGLE, size: 4, color: fill },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: fill },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: fill },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 180, bottom: 180, left: 220, right: 220 },
            children: [
              new Paragraph({
                children: inlineRuns(text, { color, size: 20 }),
                spacing: { line: 300, lineRule: LineRuleType.AUTO },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function calloutKind(text: string): "decision" | "risk" | "note" | null {
  const normalized = plainMarkdown(text).replace(/^【|】$/g, "");
  if (/^(投资建议|投资结论|初步结论|决策结论|核心结论|关键结论)[：:]/.test(normalized)) {
    return "decision";
  }
  if (/^(关键风险|风险提示|主要风险)[：:]/.test(normalized)) return "risk";
  if (/^(数据缺口|信息缺失|特别提示|重要提示|免责声明)[：:]/.test(normalized)) {
    return "note";
  }
  return null;
}

function markdownTable(rows: string[][], profile: FormalReportProfile): Table {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const columnWidth = Math.floor(CONTENT_WIDTH_DXA / columnCount);
  const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => columnWidth),
    layout: TableLayoutType.FIXED,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          cantSplit: true,
          children: Array.from({ length: columnCount }, (_, cellIndex) => {
            const isHeader = rowIndex === 0;
            return new TableCell({
              width: { size: columnWidth, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: {
                type: ShadingType.CLEAR,
                fill: isHeader
                  ? profile.accentDark
                  : rowIndex % 2 === 0
                    ? "F7F8FA"
                    : COLOR_WHITE,
              },
              margins: { top: 110, bottom: 110, left: 110, right: 110 },
              children: [
                new Paragraph({
                  children: inlineRuns(row[cellIndex] ?? "", {
                    color: isHeader ? COLOR_WHITE : COLOR_INK,
                    size: columnCount >= 6 ? 17 : 19,
                    bold: isHeader,
                  }),
                  spacing: { line: 270, lineRule: LineRuleType.AUTO },
                  alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                }),
              ],
            });
          }),
        })
    ),
  });
}

function renderContent(
  markdown: string,
  profile: FormalReportProfile,
  documentTitle: string
): FileChild[] {
  const blocks = parseFormalReportMarkdown(markdown);
  const children: FileChild[] = [];
  let numberedIndex = 0;

  for (const block of blocks) {
    if (block.type === "heading") {
      if (
        children.length === 0 &&
        plainMarkdown(block.text) === plainMarkdown(documentTitle)
      ) {
        continue;
      }
      const heading =
        block.level === 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      children.push(
        new Paragraph({
          heading,
          children: inlineRuns(block.text, {
            color: block.level === 1 ? profile.accentDark : COLOR_INK,
            size: block.level === 1 ? 31 : block.level === 2 ? 26 : 22,
            bold: true,
          }),
          spacing: {
            before: block.level === 1 ? 440 : block.level === 2 ? 300 : 220,
            after: block.level === 1 ? 220 : 150,
          },
          pageBreakBefore: block.level === 1 && children.length > 0,
          keepNext: true,
          widowControl: true,
          shading:
            block.level === 1
              ? { type: ShadingType.CLEAR, fill: profile.accentSoft }
              : undefined,
          border:
            block.level === 1
              ? {
                  left: {
                    style: BorderStyle.SINGLE,
                    size: 18,
                    color: profile.accent,
                    space: 8,
                  },
                }
              : undefined,
        })
      );
      numberedIndex = 0;
      continue;
    }

    if (block.type === "paragraph") {
      const kind = calloutKind(block.text);
      children.push(kind ? callout(block.text, profile, kind) : bodyParagraph(block.text));
      if (kind) children.push(new Paragraph({ spacing: { after: 100 } }));
      continue;
    }

    if (block.type === "bullet") {
      children.push(
        new Paragraph({
          bullet: { level: block.level },
          children: inlineRuns(block.text),
          spacing: { line: 310, lineRule: LineRuleType.AUTO, after: 90 },
          indent: { left: 420 + block.level * 320 },
          widowControl: true,
        })
      );
      continue;
    }

    if (block.type === "number") {
      numberedIndex += 1;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${numberedIndex}. `,
              bold: true,
              color: profile.accent,
              size: 21,
              font: FONT_HEADING,
            }),
            ...inlineRuns(block.text),
          ],
          indent: { left: 360 + block.level * 320, hanging: 300 },
          spacing: { line: 310, lineRule: LineRuleType.AUTO, after: 90 },
          widowControl: true,
        })
      );
      continue;
    }

    if (block.type === "quote") {
      children.push(callout(block.text, profile, calloutKind(block.text) ?? "note"));
      children.push(new Paragraph({ spacing: { after: 100 } }));
      continue;
    }

    if (block.type === "table") {
      children.push(markdownTable(block.rows, profile));
      children.push(new Paragraph({ spacing: { after: 140 } }));
      continue;
    }

    children.push(
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
        },
        spacing: { before: 120, after: 180 },
      })
    );
  }

  return children;
}

function header(profile: FormalReportProfile, metadata: FormalReportMetadata): Header {
  const name = metadata.projectName || metadata.organizationName || "Aivestor";
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: `${name}  ·  ${profile.label}`,
            color: COLOR_MUTED,
            size: 17,
            font: FONT_HEADING,
          }),
        ],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
        },
        spacing: { after: 100 },
      }),
    ],
  });
}

function footer(profile: FormalReportProfile): Footer {
  const pageChildren: ParagraphChild[] = [
    new TextRun({
      text: `Aivestor  ·  ${profile.confidentiality}    第 `,
      color: COLOR_MUTED,
      size: 16,
      font: FONT_BODY,
    }),
    new TextRun({ children: [PageNumber.CURRENT], color: COLOR_MUTED, size: 16 }),
    new TextRun({ text: " 页 / 共 ", color: COLOR_MUTED, size: 16 }),
    new TextRun({
      children: [PageNumber.TOTAL_PAGES_IN_SECTION],
      color: COLOR_MUTED,
      size: 16,
    }),
    new TextRun({ text: " 页", color: COLOR_MUTED, size: 16 }),
  ];
  return new Footer({
    children: [
      new Paragraph({
        children: pageChildren,
        alignment: AlignmentType.CENTER,
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE },
        },
        spacing: { before: 100 },
      }),
    ],
  });
}

function coverChildren(
  profile: FormalReportProfile,
  metadata: FormalReportMetadata
): FileChild[] {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(metadata.reportDate);
  const detailRows: [string, string][] = [
    ["报告类型", profile.label],
    ["报告日期", date],
  ];
  if (metadata.organizationName) detailRows.unshift(["出具机构", metadata.organizationName]);
  if (metadata.industry) detailRows.push(["所属行业", metadata.industry]);
  if (metadata.stage) detailRows.push(["项目阶段", metadata.stage]);
  if (metadata.version) detailRows.push(["文档版本", `V${metadata.version}.0`]);

  return [
    new Paragraph({
      children: [
        new TextRun({
          text: "AIVESTOR",
          bold: true,
          color: profile.accent,
          size: 25,
          font: FONT_HEADING,
          characterSpacing: 80,
        }),
      ],
      spacing: { after: 1800 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: metadata.projectName || metadata.organizationName || metadata.title,
          bold: true,
          color: profile.accentDark,
          size: 42,
          font: FONT_HEADING,
        }),
      ],
      spacing: { after: 260 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: profile.label,
          bold: true,
          color: profile.accent,
          size: 30,
          font: FONT_HEADING,
        }),
      ],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: profile.subtitle,
          color: COLOR_MUTED,
          size: 21,
          font: FONT_BODY,
        }),
      ],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 16, color: profile.accent },
      },
      spacing: { after: 720 },
    }),
    labelValueTable(detailRows),
    new Paragraph({ spacing: { after: 980 } }),
    callout(
      `${profile.confidentiality}。本报告基于现有项目材料与系统记录整理，正式使用前须由经办人员复核。`,
      profile,
      "note"
    ),
  ];
}

export async function buildFormalDocxBuffer(input: {
  profile: FormalReportProfile;
  metadata: FormalReportMetadata;
  markdown: string;
}): Promise<Buffer> {
  const { profile, metadata, markdown } = input;
  const mainHeader = header(profile, metadata);
  const mainFooter = footer(profile);
  const tocEntries = parseFormalReportMarkdown(markdown)
    .filter(
      (block): block is Extract<typeof block, { type: "heading" }> =>
        block.type === "heading"
    )
    .map((block) => ({ title: plainMarkdown(block.text), level: block.level }));

  const doc = new Document({
    creator: "Aivestor",
    title: metadata.title,
    subject: profile.label,
    description: profile.subtitle,
    keywords: `Aivestor,${profile.label},投资报告`,
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 21, color: COLOR_INK },
          paragraph: {
            spacing: { line: 330, lineRule: LineRuleType.AUTO, after: 150 },
          },
        },
        title: {
          run: { font: FONT_HEADING, size: 42, bold: true, color: profile.accentDark },
          paragraph: { spacing: { after: 260 } },
        },
        heading1: {
          run: { font: FONT_HEADING, size: 31, bold: true, color: profile.accentDark },
          paragraph: { spacing: { before: 440, after: 220 }, keepNext: true },
        },
        heading2: {
          run: { font: FONT_HEADING, size: 26, bold: true, color: COLOR_INK },
          paragraph: { spacing: { before: 300, after: 150 }, keepNext: true },
        },
        heading3: {
          run: { font: FONT_HEADING, size: 22, bold: true, color: profile.accent },
          paragraph: { spacing: { before: 220, after: 120 }, keepNext: true },
        },
      },
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA },
            margin: { top: 1200, right: 1440, bottom: 1200, left: 1440 },
          },
        },
        children: coverChildren(profile, metadata),
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA },
            margin: {
              top: 1150,
              right: 1440,
              bottom: 1250,
              left: 1440,
              header: 560,
              footer: 560,
            },
            pageNumbers: { start: 1 },
          },
        },
        headers: { default: mainHeader },
        footers: { default: mainFooter },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: inlineRuns("目录", {
              color: profile.accentDark,
              size: 31,
              bold: true,
            }),
            spacing: { after: 280 },
          }),
          new TableOfContents("目录", {
            hyperlink: true,
            headingStyleRange: "1-3",
            cachedEntries: tocEntries,
          }),
          new Paragraph({ children: [new PageBreak()] }),
          ...renderContent(markdown, profile, metadata.title),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: inlineRuns("文档说明", {
              color: profile.accentDark,
              size: 31,
              bold: true,
            }),
          }),
          callout(
            "本报告由 Aivestor 基于用户提供的材料、结构化数据及投资判断整理生成。报告中的事实、预测、估值和投资建议应在正式提交前完成独立复核；本报告不构成对任何主体的公开投资建议或承诺。",
            profile,
            "note"
          ),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
