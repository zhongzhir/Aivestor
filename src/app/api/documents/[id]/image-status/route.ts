import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { readFileBuffer } from "@/lib/fileStorage";
import {
  extractDocumentImages,
  supportsImageExtraction,
} from "@/lib/imageExtract";
import { isQwenVLAvailable } from "@/lib/qwenVL";

export const maxDuration = 60;

interface ImageAnalysisItem {
  position: string;
  description: string;
}

// GET /api/documents/[id]/image-status — 项目页判断是否显示「提取图片信息」按钮用。
//
// 返回：
//   { supported, analyzed, imageCount }
//   - supported: 该文档可做图片识别（doc_kind=bp + 支持的格式 + 系统已配置 Qwen-VL）
//   - analyzed:  image_analysis 非 NULL（已识别过，不再重复触发）
//   - imageCount: 未识别时实时检测嵌入图片数；已识别时为已识别张数
//
// imageCount 未持久化，故未识别的 BP 需实时检测（只读、幂等，不写库）。
// 失败一律静默降级为 imageCount:0，不阻断项目页。
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const docs = await query<{
    file_type: string;
    file_url: string | null;
    doc_kind: string;
    image_analysis: ImageAnalysisItem[] | null;
  }>(
    `SELECT file_type, file_url, doc_kind, image_analysis
       FROM documents
      WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (docs.length === 0) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const doc = docs[0];

  // 不具备识别条件：直接告知前端不显示按钮
  if (
    doc.doc_kind !== "bp" ||
    !supportsImageExtraction(doc.file_type) ||
    !isQwenVLAvailable()
  ) {
    return NextResponse.json({ supported: false, analyzed: false, imageCount: 0 });
  }

  // 已识别过：复用结果，不重新检测
  if (doc.image_analysis !== null) {
    return NextResponse.json({
      supported: true,
      analyzed: true,
      imageCount: doc.image_analysis.length,
    });
  }

  // 未识别：实时检测嵌入图片数量（只读）
  let imageCount = 0;
  if (doc.file_url) {
    try {
      const buffer = await readFileBuffer(doc.file_url);
      const detected = await extractDocumentImages(buffer, doc.file_type);
      imageCount = detected.images.length;
    } catch (e) {
      console.warn("[image-status] 图片检测失败（降级为 0）:", e);
    }
  }

  return NextResponse.json({ supported: true, analyzed: false, imageCount });
}
