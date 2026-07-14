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

export function parseFormalReportMarkdown(markdown: string): FormalReportBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: FormalReportBlock[] = [];
  const paragraph: string[] = [];

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

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph, out);
      out.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
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

    const bullet = /^(\s*)[-*+]\s+(.+)$/.exec(raw);
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
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph(paragraph, out);
  return out;
}
