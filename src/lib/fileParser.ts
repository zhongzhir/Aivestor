// 统一文件解析：PDF / Word / PPT / Excel → 纯文本。
// 仅在服务端运行（API 路由内调用）。

import * as XLSX from "xlsx";
import { parseDocument } from "@/lib/parser";
import { describeImage, isQwenVLAvailable } from "@/lib/qwenVL";
import { hasVisiblePageContent, openPdfOcrPages } from "@/lib/pdfOcrPages";
import { sourceMapText, type SourceMapEntry } from "@/lib/sourceMap";

export type ParsableType = "pdf" | "docx" | "pptx" | "xlsx" | "xls";

export interface ParseFileResult {
  text: string;
  warning?: string;
  sourceMap: SourceMapEntry[];
}

const EXCEL_WARNING =
  "Excel文件已提取文本，财务数据建议使用专项解析功能";

const OCR_WARNING =
  "该 PDF 原本没有可提取的文字，系统已通过 OCR 尝试识别页面内容；请抽查数字、表格和专有名词。";
const OCR_CONCURRENCY = 3;
const MAX_OCR_PAGES = 30;

// NUL 字符（U+0000）。用 fromCharCode 构造，避免源码里直接出现 NUL 字节。
const NUL_CHAR = String.fromCharCode(0);

// 去除文本中的 NUL 字符。部分 PDF 经 unpdf 解析后含 NUL，
// 而 Postgres text 字段不允许 NUL，写入会报
// 「invalid byte sequence for encoding "UTF8": 0x00」。
// 在解析层统一清理，覆盖所有文件类型与所有调用方（项目文档 / 知识库上传）。
function stripNul(text: string): string {
  return text.split(NUL_CHAR).join("");
}

// 由文件名后缀推断统一文件类型；无法识别返回空字符串。
export function getFileType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const typeMap: Record<string, string> = {
    pdf: "pdf",
    doc: "docx",
    docx: "docx",
    ppt: "pptx",
    pptx: "pptx",
    xls: "xls",
    xlsx: "xlsx",
  };
  return typeMap[ext || ""] || "";
}

// 解析 Excel：遍历所有 sheet，拼成「Sheet名称\n内容」文本块。
function parseExcel(buffer: Buffer): SourceMapEntry[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const blocks: SourceMapEntry[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;
    const decoded = XLSX.utils.decode_range(sheet["!ref"]);
    const rows: string[] = [];
    for (let row = decoded.s.r; row <= decoded.e.r; row++) {
      const cells: string[] = [];
      for (let col = decoded.s.c; col <= decoded.e.c; col++) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address];
        if (!cell || cell.v == null || String(cell.v).trim() === "") continue;
        const displayed = cell.w != null ? String(cell.w) : String(cell.v);
        cells.push(`${address}=${displayed.replace(/\s+/g, " ").trim()}`);
      }
      if (cells.length > 0) rows.push(cells.join(" | "));
    }
    if (rows.length > 0) {
      const range = XLSX.utils.encode_range(decoded);
      blocks.push({
        locator: `SHEET:${sheetName}!${range}`,
        locatorType: "sheet_range",
        label: `工作表“${sheetName}” ${range}`,
        sheet: sheetName,
        range,
        text: rows.join("\n"),
      });
    }
  }
  return blocks;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

async function parsePptx(buffer: Buffer): Promise<SourceMapEntry[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  const entries: SourceMapEntry[] = [];
  for (const name of slideNames) {
    const slide = Number(name.match(/slide(\d+)/)?.[1]);
    const xml = await zip.files[name].async("string");
    const runs = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXmlText(match[1]).trim())
      .filter(Boolean);
    if (runs.length > 0) {
      entries.push({ locator: `SLIDE${slide}`, locatorType: "slide", label: `幻灯片${slide}`, slide, text: runs.join("\n") });
    }
  }
  return entries;
}

export async function parseFile(
  buffer: Buffer,
  fileType: string,
  fileName: string
): Promise<ParseFileResult> {
  let text: string;
  let warning: string | undefined;
  let sourceMap: SourceMapEntry[] = [];

  switch (fileType) {
    case "pdf":
    case "docx": {
      // 复用现有 unpdf / mammoth 解析逻辑
      ({ text, sourceMap } = await parseDocument(buffer, fileType));
      if (fileType === "pdf" && !text.trim() && isQwenVLAvailable()) {
        const pdfPages = await openPdfOcrPages(buffer);
        try {
          // Only process complete rendered pages. Never label an image index as a page.
          const pageCount = Math.min(pdfPages.pageCount, MAX_OCR_PAGES);
          const ocrParts = new Array<string | null>(pageCount).fill(null);
          let nextPage = 1;
          async function worker() {
            while (nextPage <= pageCount) {
              const page = nextPage++;
              const image = await pdfPages.render(page);
              if (!(await hasVisiblePageContent(image))) continue;
              const result = await describeImage(image.toString("base64"), "image/png", "ocr");
              const recognized = result?.description.trim();
              if (recognized && !/^无可辨认文字[。.!！\s]*$/.test(recognized)) {
                ocrParts[page - 1] = recognized;
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(OCR_CONCURRENCY, pageCount) }, worker));
          sourceMap = ocrParts.flatMap((part, index) => part ? [{
            page: index + 1,
            text: part,
          }] : []).map(({ page, text: pageText }) => ({
            locator: `OCR-P${page}`,
            locatorType: "ocr_page",
            label: `OCR第${page}页`,
            page,
            text: pageText,
          }));
          if (sourceMap.length > 0) {
            text = sourceMapText(sourceMap);
            warning = OCR_WARNING + (pdfPages.pageCount > MAX_OCR_PAGES
              ? ` 仅处理前${MAX_OCR_PAGES}页，其余页面未识别。`
              : "");
          }
        } finally {
          await pdfPages.close();
        }
      }
      break;
    }
    case "pptx": {
      sourceMap = await parsePptx(buffer);
      text = sourceMapText(sourceMap);
      break;
    }
    case "xlsx":
    case "xls": {
      sourceMap = parseExcel(buffer);
      text = sourceMapText(sourceMap);
      warning = EXCEL_WARNING;
      break;
    }
    default:
      throw new Error(`不支持的文件格式: ${fileType || fileName}`);
  }

  // 统一清理 NUL 字符，避免写入 Postgres text 字段时报 0x00 编码错误
  return {
    text: stripNul(text),
    warning,
    sourceMap: sourceMap.map((entry) => ({ ...entry, text: stripNul(entry.text) })),
  };
}
