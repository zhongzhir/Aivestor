// 文档分块处理：将文档文本切分、批量向量化并写入 document_chunks 表。

import { query } from "@/lib/db";
import { generateEmbeddingWithBailian } from "@/lib/embedding";
import { chunkLocatedText, chunkText } from "@/lib/chunking";
import type { SourceMapEntry } from "@/lib/sourceMap";

// 对单篇文档执行 chunking + embedding 并写入 document_chunks。
// embedding 失败不阻断写入，仍保存 chunk 文本以供全文检索回退。
export async function processDocumentChunks(
  documentId: string,
  userId: string,
  extractedText: string,
  sourceMap: SourceMapEntry[] = []
): Promise<void> {
  try {
    const chunks = sourceMap.length > 0
      ? chunkLocatedText(sourceMap)
      : chunkText(extractedText);
    if (chunks.length === 0) return;

    // 一次性批量向量化所有 chunk，减少 API 请求次数
    const embeddings = await generateEmbeddingWithBailian(
      chunks.map((c) => c.content)
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = embeddings?.[i]?.vector ?? null;

      await query(
        `INSERT INTO document_chunks
           (document_id, user_id, chunk_index, content, token_count, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          documentId,
          userId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          vector ? `[${vector.join(",")}]` : null,
          JSON.stringify(chunk.metadata),
        ]
      );
    }

    console.log(`[chunks] 文档 ${documentId}：处理 ${chunks.length} 个 chunk`);
  } catch (e) {
    // chunking 失败不影响主流程
    console.error("[chunks] processDocumentChunks 出错:", e);
  }
}
