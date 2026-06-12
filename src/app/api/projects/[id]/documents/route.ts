import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseFile } from "@/lib/fileParser";
import { processDocumentChunks } from "@/lib/documentChunks";
import { extractExcelFinancials } from "@/lib/excelFinancials";
import { readFileBuffer } from "@/lib/fileStorage";
import {
  extractDocumentImages,
  supportsImageExtraction,
  ESTIMATED_TOKENS_PER_IMAGE,
} from "@/lib/imageExtract";
import { isQwenVLAvailable } from "@/lib/qwenVL";

const SUPPORTED_TYPES = ["pdf", "docx", "pptx", "xlsx", "xls"];
const ALLOWED_DOC_KINDS = [
  "bp",
  "research",
  "contract",
  "financial_model",
  "news",
  "other",
] as const;
type DocKind = (typeof ALLOWED_DOC_KINDS)[number];

export const maxDuration = 120;

// GET /api/projects/[id]/documents — 项目下所有已上传文件
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 同步校验项目归属
  const owned = await query<{ id: string }>(
    "SELECT id FROM projects WHERE id = $1 AND user_id = $2",
    [params.id, session.user.id]
  );
  if (owned.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const documents = await query(
    `SELECT id, filename, file_type, doc_kind, parse_status, created_at
       FROM documents
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at DESC`,
    [params.id, session.user.id]
  );
  return NextResponse.json({ documents });
}

// POST /api/projects/[id]/documents — 从 Blob URL 拉取 BP 文件并解析文本
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 校验项目归属
  const owned = await query<{ id: string }>(
    "SELECT id FROM projects WHERE id = $1 AND user_id = $2",
    [params.id, session.user.id]
  );
  if (owned.length === 0) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: {
    blobUrl?: string;
    filename?: string;
    fileType?: string;
    doc_kind?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { blobUrl, filename, fileType: fileTypeRaw } = body;
  if (!blobUrl || !filename) {
    return NextResponse.json({ error: "缺少文件信息" }, { status: 400 });
  }
  // 校验 doc_kind 入参，非法值兜底为 'bp'
  const docKind: DocKind =
    typeof body.doc_kind === "string" &&
    (ALLOWED_DOC_KINDS as readonly string[]).includes(body.doc_kind)
      ? (body.doc_kind as DocKind)
      : "bp";

  const fileType = fileTypeRaw ?? "";
  if (!SUPPORTED_TYPES.includes(fileType)) {
    return NextResponse.json(
      { error: "仅支持 PDF、Word、PPT、Excel 格式" },
      { status: 400 }
    );
  }

  // 读取文件（自动识别 oss:// / local:// / https://）
  let buffer: Buffer;
  try {
    buffer = await readFileBuffer(blobUrl);
  } catch (err) {
    return NextResponse.json({ error: "文件读取失败" }, { status: 422 });
  }

  // 解析文本
  let parsed;
  console.log("[documents] 开始解析，fileType:", fileType, "bufferSize:", buffer.length);
  try {
    parsed = await parseFile(buffer, fileType, filename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    return NextResponse.json(
      { error: `文档解析失败：${msg}`, detail: stack },
      { status: 422 }
    );
  }

  if (parsed.text.length === 0) {
    return NextResponse.json(
      { error: "未能从文档中提取到文字，请确认文件非扫描件/纯图片，或转换为可选中文字的格式后重试" },
      { status: 422 }
    );
  }

  // 文件已存于 Vercel Blob，直接记录其 URL
  const fileUrl = blobUrl;

  const rows = await query<{ id: string }>(
    `INSERT INTO documents
       (user_id, project_id, filename, file_type, file_url, file_size,
        doc_kind, extracted_text, parse_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'done')
     RETURNING id`,
    [
      session.user.id,
      params.id,
      filename,
      fileType,
      fileUrl,
      buffer.length,
      docKind,
      parsed.text,
    ]
  );

  const documentId = rows[0].id;

  // 切分并向量化文档（await 确保 Vercel 上可靠写入）
  await processDocumentChunks(documentId, session.user.id, parsed.text);

  // Excel：直接从单元格结构化提取财务数据并写入 projects.financial_data
  if (fileType === "xlsx" || fileType === "xls") {
    try {
      const fin = extractExcelFinancials(buffer);
      if (fin) {
        await query("UPDATE projects SET financial_data = $1 WHERE id = $2", [
          JSON.stringify(fin),
          params.id,
        ]);
        console.log("[documents] Excel 财务数据已写入 financial_data");
      }
    } catch (e) {
      console.error("[documents] Excel 财务提取失败:", e);
    }
  }

  // BP 文档：检测内嵌图片（经预筛选），供前端弹确认提示（按需 Qwen-VL 识别）
  let imageCount = 0;
  let estimatedTokens = 0;
  if (docKind === "bp" && supportsImageExtraction(fileType) && isQwenVLAvailable()) {
    try {
      const detected = await extractDocumentImages(buffer, fileType);
      imageCount = detected.images.length;
      estimatedTokens = imageCount * ESTIMATED_TOKENS_PER_IMAGE;
    } catch (e) {
      console.warn("[documents] 图片检测失败（不影响上传）:", e);
    }
  }

  return NextResponse.json(
    {
      id: documentId,
      filename,
      charCount: parsed.text.length,
      warning: parsed.warning,
      imageCount,
      estimatedTokens,
    },
    { status: 201 }
  );
}
