import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { readFileBuffer } from "@/lib/fileStorage";
import {
  extractDocumentImages,
  supportsImageExtraction,
} from "@/lib/imageExtract";
import { describeImage, isQwenVLAvailable } from "@/lib/qwenVL";
import { consumeQuota } from "@/lib/freeQuota";
import { processDocumentChunks } from "@/lib/documentChunks";

export const maxDuration = 300;

interface ImageAnalysisItem {
  position: string;
  description: string;
}

// POST /api/documents/[id]/image-analysis — 按需触发 BP 内嵌图片识别（Qwen-VL）
// 结果持久化到 documents.image_analysis 并拼入 extracted_text；
// 已识别过的文档直接复用，不重复调用。
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const docs = await query<{
    id: string;
    file_type: string;
    file_url: string | null;
    doc_kind: string;
    extracted_text: string | null;
    image_analysis: ImageAnalysisItem[] | null;
  }>(
    `SELECT id, file_type, file_url, doc_kind, extracted_text, image_analysis
       FROM documents
      WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (docs.length === 0) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const doc = docs[0];

  if (doc.doc_kind !== "bp") {
    return NextResponse.json(
      { error: "仅 BP 文档支持图片识别" },
      { status: 400 }
    );
  }
  if (!supportsImageExtraction(doc.file_type)) {
    return NextResponse.json(
      { error: "该文件格式不支持图片提取" },
      { status: 400 }
    );
  }
  if (!isQwenVLAvailable()) {
    return NextResponse.json(
      { error: "系统未配置图片识别服务" },
      { status: 503 }
    );
  }

  // 已识别过：直接复用，不重复调用 Qwen-VL
  if (doc.image_analysis !== null) {
    return NextResponse.json({
      reused: true,
      count: doc.image_analysis.length,
      failed: 0,
      skipped: 0,
    });
  }

  if (!doc.file_url) {
    return NextResponse.json({ error: "原始文件不存在" }, { status: 422 });
  }
  let buffer: Buffer;
  try {
    buffer = await readFileBuffer(doc.file_url);
  } catch {
    return NextResponse.json({ error: "文件读取失败" }, { status: 422 });
  }

  // 提取嵌入图片（含预筛选与数量截取）
  let extraction;
  try {
    extraction = await extractDocumentImages(buffer, doc.file_type);
  } catch (e) {
    console.error("[image-analysis] 图片提取失败:", e);
    return NextResponse.json({ error: "图片提取失败" }, { status: 422 });
  }

  // 逐张调用 Qwen-VL，单张失败跳过不阻断
  const results: ImageAnalysisItem[] = [];
  let failed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const img of extraction.images) {
    const res = await describeImage(img.base64, img.mimeType);
    if (!res) {
      failed++;
      console.warn(`[image-analysis] 图片识别失败，跳过（${img.position}）`);
      continue;
    }
    results.push({ position: img.position, description: res.description });
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
  }

  // 额度计入（与 report_generation 等共用同一额度池）
  await consumeQuota(session.user.id, tokensIn, tokensOut, "image_recognition");

  // 识别结果拼入 extracted_text（文末追加，标注来源位置便于报告引用与溯源）
  let newText = doc.extracted_text ?? "";
  if (results.length > 0) {
    const blocks = results.map(
      (r, i) => `[图片${i + 1}描述]（${r.position}）：${r.description}`
    );
    if (extraction.skippedCount > 0) {
      blocks.push(`（另有 ${extraction.skippedCount} 张图片未处理）`);
    }
    newText = `${newText}\n\n=== 图片信息（AI 识别） ===\n${blocks.join("\n\n")}`;
  }

  // 持久化：image_analysis 非 NULL（含空数组）即表示已识别过，避免重复触发
  await query(
    `UPDATE documents
        SET image_analysis = $1, extracted_text = $2, updated_at = NOW()
      WHERE id = $3`,
    [JSON.stringify(results), newText, doc.id]
  );

  // 文本变化后重建 chunk（先清旧再重切，保证检索一致性）
  if (results.length > 0) {
    try {
      await query("DELETE FROM document_chunks WHERE document_id = $1", [doc.id]);
      await processDocumentChunks(doc.id, session.user.id, newText);
    } catch (e) {
      console.error("[image-analysis] 重建 chunk 失败:", e);
    }
  }

  return NextResponse.json({
    reused: false,
    count: results.length,
    failed,
    skipped: extraction.skippedCount,
    tokensUsed: tokensIn + tokensOut,
  });
}
