import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { parseFile, getFileType } from "@/lib/fileParser";
import { isValidCategory } from "@/lib/knowledgeCategories";
import { readFileBuffer } from "@/lib/fileStorage";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

export const maxDuration = 120;

// POST /api/knowledge/upload — 上传文件并收录进知识库
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: {
      blobUrl?: string;
      fileName?: string;
      fileSize?: number;
      category?: string;
      shared?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const { blobUrl, fileName, fileSize, category } = body;
    if (!blobUrl || !fileName) {
      return NextResponse.json({ error: "缺少文件信息" }, { status: 400 });
    }
    if (!isValidCategory(category)) {
      return NextResponse.json({ error: "分类不合法" }, { status: 422 });
    }

    const fileType = getFileType(fileName);
    if (!fileType) {
      return NextResponse.json(
        { error: "仅支持 PDF、Word、PPT、Excel 格式" },
        { status: 400 }
      );
    }

    // 1. 读取文件（自动识别 oss:// / local:// / https://）
    let buffer: Buffer;
    try {
      buffer = await readFileBuffer(blobUrl);
    } catch {
      return NextResponse.json({ error: "文件读取失败" }, { status: 422 });
    }

    // 2. 解析文本
    let parsed;
    try {
      parsed = await parseFile(buffer, fileType, fileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `文档解析失败：${msg}` },
        { status: 422 }
      );
    }
    if (parsed.text.length === 0) {
      return NextResponse.json(
        { error: "未能从文件中提取到文字" },
        { status: 422 }
      );
    }

    // 3. 生成 embedding（百炼未配置或失败则仅保留全文检索）
    let embeddingVector: number[] | null = null;
    let embeddingModel: string | null = null;
    const result = await generateEmbedding(parsed.text);
    if (result) {
      embeddingVector = result.vector;
      embeddingModel = result.model;
    }

    // 目标层：默认个人私有；shared 且开通 org_knowledge 时直接收录到机构层。
    let orgId: string | null = null;
    let visibility = "private";
    let promotedBy: string | null = null;
    if (body.shared) {
      const scope = await buildAccessScope(session.user.id);
      if (scope.org && (await hasCapability(scope.org.orgId, "org_knowledge"))) {
        orgId = scope.org.orgId;
        visibility = "org";
        promotedBy = session.user.id;
      }
    }

    // 4. 写入 knowledge_base_entries
    const metadata = {
      fileName,
      fileSize: fileSize ?? buffer.length,
      fileType,
      ...(parsed.warning ? { warning: parsed.warning } : {}),
    };
    const inserted = await query<{ id: string }>(
      `INSERT INTO knowledge_base_entries
         (user_id, content, source_type, tags, embedding, embedding_model, metadata,
          org_id, visibility, promoted_by, promoted_at)
       VALUES ($1, $2, 'document', $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $9::uuid IS NULL THEN NULL ELSE NOW() END)
       RETURNING id`,
      [
        session.user.id,
        parsed.text,
        JSON.stringify([category]),
        embeddingVector ? `[${embeddingVector.join(",")}]` : null,
        embeddingModel,
        JSON.stringify(metadata),
        orgId,
        visibility,
        promotedBy,
      ]
    );

    return NextResponse.json(
      { success: true, entryId: inserted[0].id, warning: parsed.warning },
      { status: 201 }
    );
  } catch (e) {
    console.error("[knowledge/upload] 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "上传失败" },
      { status: 500 }
    );
  }
}
