import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { sourceMapText, type SourceMapEntry } from "@/lib/sourceMap";

// 文档解析：从 PDF / Word 提取纯文本，供 AI 与知识库使用。
// 仅在服务端运行（API 路由内调用）。

export type ParsableFileType = "pdf" | "docx";

export interface ParseResult {
  text: string;
  charCount: number;
  sourceMap: SourceMapEntry[];
}

// 由文件名 / MIME 推断类型；不支持的格式返回 null。
export function detectFileType(
  filename: string,
  mime?: string
): ParsableFileType | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

export async function parseDocument(
  buffer: Buffer,
  fileType: ParsableFileType
): Promise<ParseResult> {
  let text = "";
  let sourceMap: SourceMapEntry[] = [];

  if (fileType === "pdf") {
    // unpdf：专为 serverless 环境设计的 PDF 文本提取
    console.log("[parser] unpdf extractText 开始，buffer大小:", buffer.length);
    const pdf = await getDocumentProxy(new Uint8Array(buffer), {
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/",
      cMapPacked: true,
    });
    const { text: pages } = await extractText(pdf, { mergePages: false });
    sourceMap = pages.flatMap((pageText, index) => {
      const clean = String(pageText).replace(/\n{3,}/g, "\n\n").trim();
      return clean
        ? [{ locator: `P${index + 1}`, locatorType: "page" as const, label: `第${index + 1}页`, page: index + 1, text: clean }]
        : [];
    });
    text = sourceMapText(sourceMap);
    console.log("[parser] extractText 完成，文本长度:", text.length);
  } else {
    const result = await mammoth.extractRawText({ buffer });
    const paragraphs = result.value
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const blockSize = 20;
    for (let start = 0; start < paragraphs.length; start += blockSize) {
      const end = Math.min(start + blockSize, paragraphs.length);
      sourceMap.push({
        locator: `PARA${start + 1}-${end}`,
        locatorType: "paragraph_range",
        label: `段落${start + 1}-${end}`,
        paragraphStart: start + 1,
        paragraphEnd: end,
        text: paragraphs.slice(start, end).join("\n"),
      });
    }
    text = sourceMapText(sourceMap);
  }

  // 折叠多余空行，去首尾空白
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return { text, charCount: text.length, sourceMap };
}
