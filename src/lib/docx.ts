// Markdown → docx 转换的共享工具（报告导出与协会底稿导出共用）。
// 原实现内联于 /api/reports/[id]/export；抽取至此以便多处复用，行为保持一致。

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

// 把一行文本中的 **加粗** 标记转为 docx TextRun。
export function inlineRuns(text: string): TextRun[] {
  return text
    .split("**")
    .map((seg, i) => new TextRun({ text: seg, bold: i % 2 === 1 }));
}

// 将 Markdown 转为 docx 段落数组（支持 #/##/### 标题、- * 列表、加粗正文）。
export function markdownToParagraphs(markdown: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      out.push(new Paragraph({ children: [] }));
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: inlineRuns(line.slice(4)),
        })
      );
    } else if (line.startsWith("## ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: inlineRuns(line.slice(3)),
        })
      );
    } else if (line.startsWith("# ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: inlineRuns(line.slice(2)),
        })
      );
    } else if (/^[-*]\s+/.test(line)) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineRuns(line.replace(/^[-*]\s+/, "")),
        })
      );
    } else {
      out.push(new Paragraph({ children: inlineRuns(line) }));
    }
  }
  return out;
}

// 由标题 + Markdown 正文构建 docx 二进制。
export async function buildDocxBuffer(
  title: string,
  markdown: string
): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: title })],
          }),
          ...markdownToParagraphs(markdown),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
