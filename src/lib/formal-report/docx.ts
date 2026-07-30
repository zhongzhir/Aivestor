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
import { BRAND } from "@/lib/brand";

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
    .replace(/\*\*|__/g, "")
    .replace(/\\([\\`*{}\[\]()#+.!_>\-])/g, "$1")
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
          size: options?.size ?? 22,
          font: FONT_BODY,
        })
    );
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: inlineRuns(text),
    spacing: { line: 345, lineRule: LineRuleType.AUTO, after: 170 },
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
  if (/^(投资建议|投资结论|初步结论|决策结论|核心结论|关键结论|核心分析视角|核心观点|核心判断)[：:]/.test(normalized)) {
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
  let primarySectionIndex = 0;

  function secondaryHeadingColors(text: string) {
    const clean = plainMarkdown(text).toLowerCase();
    if (/strengths|优势/.test(clean)) return { color: "256D4B", fill: "EAF5EF" };
    if (/weaknesses|劣势/.test(clean)) return { color: "9A6700", fill: "FFF4D6" };
    if (/opportunities|机会/.test(clean)) return { color: "245A9A", fill: "EAF2FB" };
    if (/threats|威胁|风险/.test(clean)) return { color: COLOR_RISK, fill: COLOR_RISK_SOFT };
    return { color: profile.accentDark, fill: profile.accentSoft };
  }

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
      if (block.level === 1) primarySectionIndex += 1;
      const secondaryColors = secondaryHeadingColors(block.text);
      const headingChildren: TextRun[] = [];
      if (block.level === 1) {
        headingChildren.push(
          new TextRun({
            text: `${String(primarySectionIndex).padStart(2, "0")}  `,
            color: profile.accent,
            size: 20,
            bold: true,
            font: FONT_HEADING,
          })
        );
      }
      headingChildren.push(
        ...inlineRuns(block.text, {
          color:
            block.level === 1
              ? COLOR_WHITE
              : block.level === 2
                ? secondaryColors.color
                : profile.accentDark,
          size: block.level === 1 ? 30 : block.level === 2 ? 25 : 22,
          bold: true,
        })
      );
      children.push(
        new Paragraph({
          heading,
          children: headingChildren,
          spacing: {
            before: block.level === 1 ? 480 : block.level === 2 ? 320 : 230,
            after: block.level === 1 ? 250 : 160,
          },
          pageBreakBefore: block.level === 1 && children.length > 0,
          keepNext: true,
          widowControl: true,
          indent:
            block.level === 1
              ? { left: 220, right: 160 }
              : block.level === 2
                ? { left: 160, right: 100 }
                : undefined,
          shading:
            block.level === 1
              ? { type: ShadingType.CLEAR, fill: profile.accentDark }
              : block.level === 2
                ? { type: ShadingType.CLEAR, fill: secondaryColors.fill }
                : undefined,
          border:
            block.level <= 2
              ? {
                  left: {
                    style: BorderStyle.SINGLE,
                    size: block.level === 1 ? 22 : 14,
                    color:
                      block.level === 1 ? profile.accent : secondaryColors.color,
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
          spacing: { line: 330, lineRule: LineRuleType.AUTO, after: 110 },
          widowControl: true,
        })
      );
      continue;
    }

    if (block.type === "number") {
      const ordinal = block.ordinal ?? String(numberedIndex + 1);
      const ordinalNumber = Number.parseInt(ordinal, 10);
      numberedIndex = Number.isFinite(ordinalNumber)
        ? ordinalNumber
        : numberedIndex + 1;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${ordinal}. `,
              bold: true,
              color: profile.accent,
              size: 21,
              font: FONT_HEADING,
            }),
            ...inlineRuns(block.text),
          ],
          indent: { left: 360 + block.level * 320, hanging: 300 },
          spacing: { line: 330, lineRule: LineRuleType.AUTO, after: 130 },
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
  const name = metadata.projectName || metadata.organizationName || BRAND.productName;
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
      text: `${BRAND.productName}  ·  ${profile.confidentiality}    第 `,
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
    ["出具日期", date],
  ];
  if (metadata.organizationName) detailRows.unshift(["出具机构", metadata.organizationName]);
  if (metadata.industry) detailRows.push(["所属行业", metadata.industry]);
  if (metadata.stage) detailRows.push(["项目阶段", metadata.stage]);
  if (metadata.version) detailRows.push(["文档版本", `V${metadata.version}.0`]);

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TableBorders.NONE,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: profile.accentDark },
              margins: { top: 520, bottom: 560, left: 520, right: 480 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${BRAND.englishName}  /  INVESTMENT DESK`,
                      bold: true,
                      color: profile.accent,
                      size: 19,
                      font: FONT_HEADING,
                      characterSpacing: 45,
                    }),
                  ],
                  spacing: { after: 920 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text:
                        metadata.projectName ||
                        metadata.organizationName ||
                        metadata.title,
                      bold: true,
                      color: COLOR_WHITE,
                      size: 44,
                      font: FONT_HEADING,
                    }),
                  ],
                  spacing: { after: 220 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: profile.label,
                      bold: true,
                      color: profile.accent,
                      size: 29,
                      font: FONT_HEADING,
                    }),
                  ],
                  spacing: { after: 100 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: profile.subtitle,
                      color: "C7D0E0",
                      size: 19,
                      font: FONT_BODY,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 520 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: "REPORT INFORMATION",
          bold: true,
          color: profile.accent,
          size: 17,
          font: FONT_HEADING,
          characterSpacing: 35,
        }),
      ],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 8, color: profile.accent },
      },
      spacing: { after: 220 },
    }),
    labelValueTable(detailRows),
    new Paragraph({ spacing: { after: 520 } }),
    callout(
      `${profile.confidentiality}。本报告基于现有项目材料与系统记录整理，正式使用前须由经办人员复核。`,
      profile,
      "note"
    ),
  ];
}

function staticTableOfContents(
  entries: { title: string; level: 1 | 2 | 3 }[],
  profile: FormalReportProfile
): FileChild[] {
  const visible = entries.filter((entry) => entry.level <= 2);
  if (visible.length === 0) {
    return [bodyParagraph("正文未使用可识别的章节标题。")];
  }

  let sectionIndex = 0;
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: TableBorders.NONE,
      rows: visible.map((entry) => {
        if (entry.level === 1) sectionIndex += 1;
        const isPrimary = entry.level === 1;
        const bottomBorder = {
          style: BorderStyle.SINGLE,
          size: isPrimary ? 8 : 3,
          color: isPrimary ? profile.accentSoft : COLOR_LINE,
        };
        return new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 13, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              borders: { bottom: bottomBorder },
              margins: { top: 150, bottom: 150, left: 60, right: 80 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: isPrimary
                        ? String(sectionIndex).padStart(2, "0")
                        : "—",
                      bold: isPrimary,
                      color: isPrimary ? profile.accent : COLOR_MUTED,
                      size: isPrimary ? 24 : 18,
                      font: FONT_HEADING,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 87, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              borders: { bottom: bottomBorder },
              margins: {
                top: isPrimary ? 180 : 120,
                bottom: isPrimary ? 180 : 120,
                left: isPrimary ? 100 : 360,
                right: 80,
              },
              children: [
                new Paragraph({
                  children: inlineRuns(entry.title, {
                    color: isPrimary ? profile.accentDark : COLOR_MUTED,
                    size: isPrimary ? 23 : 19,
                    bold: isPrimary,
                  }),
                }),
              ],
            }),
          ],
        });
      }),
    }),
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
    creator: BRAND.legalName,
    title: metadata.title,
    subject: profile.label,
    description: profile.subtitle,
    keywords: `${BRAND.name},${profile.label},投资报告`,
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 22, color: COLOR_INK },
          paragraph: {
            spacing: { line: 345, lineRule: LineRuleType.AUTO, after: 170 },
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
            margin: { top: 720, right: 1180, bottom: 900, left: 1180 },
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
            children: inlineRuns("目录  /  CONTENTS", {
              color: profile.accentDark,
              size: 30,
              bold: true,
            }),
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 12, color: profile.accent },
            },
            spacing: { after: 340 },
          }),
          ...staticTableOfContents(tocEntries, profile),
          new Paragraph({ children: [new PageBreak()] }),
          ...renderContent(markdown, profile, metadata.title),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: true,
            shading: { type: ShadingType.CLEAR, fill: profile.accentDark },
            border: {
              left: { style: BorderStyle.SINGLE, size: 18, color: profile.accent },
            },
            indent: { left: 180, right: 120 },
            spacing: { before: 0, after: 260, line: 340 },
            children: inlineRuns("文档说明", {
              color: "FFFFFF",
              size: 31,
              bold: true,
            }),
          }),
          callout(
            `本报告由 ${BRAND.productName} 基于用户提供的材料、结构化数据及投资判断整理生成。报告中的事实、预测、估值和投资建议应在正式提交前完成独立复核；本报告不构成对任何主体的公开投资建议或承诺。`,
            profile,
            "note"
          ),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
