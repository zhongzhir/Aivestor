// 向量化（架构文档 v1.1 第 5.4 阶段 5）。
//   调用阿里云百炼 text-embedding-v4（1536 维），与主应用 src/lib/embedding.ts 相同的
//   请求参数约定，但【独立实现，不 import 主应用代码】（服务隔离）。
//   未配置 BAILIAN_API_KEY 时返回 null 向量，调用方降级为纯文本检索（不阻塞写入）。

import type { NarratedFeature, EmbeddedFeature } from "../types";

const BAILIAN_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const BAILIAN_MODEL = "text-embedding-v4";
const EMBEDDING_DIMENSIONS = 1536; // 固定 1536 以匹配 zjjr_features.embedding VECTOR(1536)
const MAX_BATCH = 10; // 百炼单次请求最多 10 条输入
const MAX_CHARS = 6000;

// 批量生成 embedding；返回与输入等长、顺序一致的数组；未配置 Key / 失败返回 null。
async function generateEmbeddings(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return null;
  if (texts.length === 0) return [];

  const inputs = texts.map((t) => (t ?? "").slice(0, MAX_CHARS));
  try {
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += MAX_BATCH) {
      const batch = inputs.slice(i, i + MAX_BATCH);
      const res = await fetch(BAILIAN_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: BAILIAN_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
          encoding_format: "float",
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[zjjr-embed] 请求失败 ${res.status}: ${detail}`);
        return null;
      }
      const data = (await res.json()) as {
        data?: { index: number; embedding: number[] }[];
      };
      const items = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
      for (const it of items) {
        if (!it.embedding) {
          console.error("[zjjr-embed] 返回缺失向量");
          return null;
        }
        out.push(it.embedding);
      }
    }
    if (out.length !== inputs.length) {
      console.error("[zjjr-embed] 向量数量与输入不匹配");
      return null;
    }
    return out;
  } catch (e) {
    console.error("[zjjr-embed] 异常:", e);
    return null;
  }
}

export async function embedFeatures(
  features: NarratedFeature[]
): Promise<EmbeddedFeature[]> {
  const vectors = await generateEmbeddings(features.map((f) => f.content));
  return features.map((f, i) => ({
    ...f,
    embedding: vectors ? vectors[i] : null,
  }));
}
