import type { FormalReportBlock } from "@/lib/formal-report/types";

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

function flushParagraph(parts: string[], out: FormalReportBlock[]) {
  const text = parts.join(" ").trim();
  if (text) out.push({ type: "paragraph", text });
  parts.length = 0;
}

export function normalizeFormalReportMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstContent = lines.findIndex((line) => line.trim());
  if (
    firstContent >= 0 &&
    /^好的[，,]/.test(lines[firstContent].trim()) &&
    /(我将|作为资深|遵循您的指令)/.test(lines[firstContent])
  ) {
    let end = firstContent;
    while (end < lines.length && lines[end].trim()) end += 1;
    lines.splice(firstContent, end - firstContent);
  }
  return lines.join("\n").trim();
}

export function parseFormalReportMarkdown(markdown: string): FormalReportBlock[] {
  const lines = normalizeFormalReportMarkdown(markdown).split("\n");
  const out: FormalReportBlock[] = [];
  const paragraph: string[] = [];
  const headingDepths = lines
    .map((line) => /^(#{1,6})\s+/.exec(line.trim())?.[1].length)
    .filter((depth): depth is number => depth != null);
  const baseHeadingDepth = headingDepths.length
    ? Math.min(...headingDepths)
    : 1;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      flushParagraph(paragraph, out);
      continue;
    }

    const tableNext = lines[i + 1]?.trim();
    if (line.includes("|") && tableNext && isTableSeparator(tableNext)) {
      flushParagraph(paragraph, out);
      const rows = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push({ type: "table", rows });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph, out);
      const normalizedLevel = Math.min(
        3,
        Math.max(1, heading[1].length - baseHeadingDepth + 1)
      ) as 1 | 2 | 3;
      out.push({
        type: "heading",
        level: normalizedLevel,
        text: heading[2].trim(),
      });
      continue;
    }

    const strongNumbered = /^\*\*(\d+)[.)、]\s*(.+?)\*\*([：:].*)?$/.exec(
      line
    );
    if (strongNumbered) {
      flushParagraph(paragraph, out);
      out.push({
        type: "number",
        ordinal: strongNumbered[1],
        text: `**${strongNumbered[2]}**${strongNumbered[3] ?? ""}`,
        level: 0,
      });
      continue;
    }

    const strongSubheading = /^\*\*(.+?)\*\*[：:]$/.exec(line);
    if (strongSubheading && strongSubheading[1].length <= 48) {
      flushParagraph(paragraph, out);
      out.push({ type: "heading", level: 3, text: strongSubheading[1] });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph(paragraph, out);
      out.push({ type: "divider" });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph(paragraph, out);
      const quote = [line.replace(/^>\s?/, "")];
      while (lines[i + 1]?.trim().startsWith(">")) {
        i += 1;
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
      }
      out.push({ type: "quote", text: quote.join(" ") });
      continue;
    }

    const bullet = /^(\s*)(?:[-*+]|[•▪■●◆])\s+(.+)$/.exec(raw);
    if (bullet) {
      flushParagraph(paragraph, out);
      out.push({
        type: "bullet",
        text: bullet[2].trim(),
        level: Math.min(2, Math.floor(bullet[1].length / 2)),
      });
      continue;
    }

    const numbered = /^(\s*)\d+[.)、]\s*(.+)$/.exec(raw);
    if (numbered) {
      flushParagraph(paragraph, out);
      out.push({
        type: "number",
        text: numbered[2].trim(),
        level: Math.min(2, Math.floor(numbered[1].length / 2)),
        ordinal: /^\s*(\d+)/.exec(raw)?.[1],
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph(paragraph, out);
  return out;
}
