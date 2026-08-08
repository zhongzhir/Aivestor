export interface IntelligenceSourceDefinition {
  key: string;
  name: string;
  homepage: string;
  kind: "rss" | "html";
  endpoint: string;
  articlePath: RegExp;
  aliases: string[];
}

// 首批只锁定官方一手来源，避免把转载、营销软文和未经核验的聚合站混入情报。
// 新来源必须先经过来源质量评估，再加入这里。
export const HIGH_VALUE_INTELLIGENCE_SOURCES: IntelligenceSourceDefinition[] = [
  {
    key: "openai-news",
    name: "OpenAI News",
    homepage: "https://openai.com/news/",
    kind: "rss",
    endpoint: "https://openai.com/news/rss.xml",
    articlePath: /^https:\/\/openai\.com\/(index\/)?[^?]+/i,
    aliases: ["OpenAI", "GPT", "ChatGPT", "Codex"],
  },
  {
    key: "anthropic-news",
    name: "Anthropic Newsroom",
    homepage: "https://www.anthropic.com/news",
    kind: "html",
    endpoint: "https://www.anthropic.com/news",
    articlePath: /^https:\/\/www\.anthropic\.com\/news\/.+/i,
    aliases: ["Anthropic", "Claude"],
  },
  {
    key: "google-deepmind-blog",
    name: "Google DeepMind Blog",
    homepage: "https://deepmind.google/blog/",
    kind: "html",
    endpoint: "https://deepmind.google/blog/",
    articlePath: /^https:\/\/deepmind\.google\/blog\/.+/i,
    aliases: ["Google DeepMind", "Gemini", "Gemma", "AlphaFold"],
  },
  {
    key: "nvidia-newsroom",
    name: "NVIDIA Newsroom",
    homepage: "https://nvidianews.nvidia.com/news/latest",
    kind: "rss",
    endpoint: "https://nvidianews.nvidia.com/rss",
    articlePath: /^https:\/\/nvidianews\.nvidia\.com\/news\/.+/i,
    aliases: ["NVIDIA", "CUDA", "NIM", "DGX"],
  },
  {
    key: "microsoft-ai",
    name: "Microsoft AI / Official Blog",
    homepage: "https://blogs.microsoft.com/ai/",
    kind: "html",
    endpoint: "https://blogs.microsoft.com/ai/",
    articlePath: /^https:\/\/blogs\.microsoft\.com\/(ai|blog)\/.+/i,
    aliases: ["Microsoft", "Azure AI", "Copilot", "Phi"],
  },
];

export function sourceByKey(key: string): IntelligenceSourceDefinition | undefined {
  return HIGH_VALUE_INTELLIGENCE_SOURCES.find((source) => source.key === key);
}
