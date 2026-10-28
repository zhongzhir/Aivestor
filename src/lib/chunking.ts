// 文本切分工具：将长文档按段落/句子切分为 chunk，便于分别向量化。

export interface Chunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: {
    sectionHint?: string;
    locator?: string;
    locatorType?: string;
    label?: string;
  };
}

const TARGET_CHUNK_SIZE = 400; // 目标字符数（中文约等于字数）
const OVERLAP_SIZE = 50; // 相邻 chunk 重叠字符数
const MAX_CHUNK_SIZE = 600; // 硬上限

// 估算 token 数（中文 1 字≈1 token，英文 4 字符≈1 token）
function estimateTokens(text: string): number {
  const chineseCount = (text.match(/[一-龥]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return chineseCount + Math.ceil(otherCount / 4);
}

// 将文本按段落切分为 chunks
export function chunkText(text: string): Chunk[] {
  if (!text || text.trim().length === 0) return [];

  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Chunk[] = [];
  let currentChunk = "";
  let chunkIndex = 0;

  const flush = () => {
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        tokenCount: estimateTokens(currentChunk),
        metadata: {},
      });
    }
    currentChunk = "";
  };

  for (const paragraph of paragraphs) {
    // 段落本身超过硬上限，需要再按句子切分
    if (paragraph.length > MAX_CHUNK_SIZE) {
      flush();
      const sentences = paragraph.split(/(?<=[。！？.!?])\s*/);
      for (const sentence of sentences) {
        if (
          currentChunk.length + sentence.length > MAX_CHUNK_SIZE &&
          currentChunk.length > 0
        ) {
          const overlap = currentChunk.slice(-OVERLAP_SIZE);
          flush();
          currentChunk = overlap + sentence;
        } else {
          currentChunk += sentence;
        }
      }
      continue;
    }

    // 普通段落：累积到接近目标大小时输出
    if (
      currentChunk.length + paragraph.length > TARGET_CHUNK_SIZE &&
      currentChunk.length > 0
    ) {
      const overlap = currentChunk.slice(-OVERLAP_SIZE);
      flush();
      currentChunk = overlap + "\n" + paragraph;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + paragraph;
    }
  }

  flush();
  return chunks;
}

export function chunkLocatedText(
  entries: Array<{
    locator: string;
    locatorType: string;
    label: string;
    text: string;
  }>
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const entry of entries) {
    for (const chunk of chunkText(entry.text)) {
      chunks.push({
        ...chunk,
        chunkIndex: chunks.length,
        metadata: {
          ...chunk.metadata,
          locator: entry.locator,
          locatorType: entry.locatorType,
          label: entry.label,
        },
      });
    }
  }
  return chunks;
}
