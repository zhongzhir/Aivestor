export interface IntelligenceSourceDefinition {
  key: string;
  name: string;
  category: string;
  coverage: "general" | "domain";
  trustLevel: "official" | "regulatory" | "authoritative";
  priority: number;
  homepage: string;
  kind: "rss" | "html";
  endpoint: string;
  articlePath: RegExp;
  aliases: string[];
}

// 来源注册表是全局能力，不绑定任何一个情报主题。
// coverage=domain 代表该来源重点覆盖某个领域；coverage=general 代表可服务多个研究主题。
// 新来源必须先经过来源质量评估，再加入这里。全网搜索/网页发现由采集器独立负责。
export const TRUSTED_INTELLIGENCE_SOURCES: IntelligenceSourceDefinition[] = [
  {
    key: "openai-news",
    name: "OpenAI News",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://openai.com/news/",
    kind: "rss",
    endpoint: "https://openai.com/news/rss.xml",
    articlePath: /^https:\/\/openai\.com\/(index\/)?[^?]+/i,
    aliases: ["OpenAI", "GPT", "ChatGPT", "Codex"],
  },
  {
    key: "anthropic-news",
    name: "Anthropic Newsroom",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://www.anthropic.com/news",
    kind: "html",
    endpoint: "https://www.anthropic.com/news",
    articlePath: /^https:\/\/www\.anthropic\.com\/news\/.+/i,
    aliases: ["Anthropic", "Claude"],
  },
  {
    key: "google-deepmind-blog",
    name: "Google DeepMind Blog",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://deepmind.google/blog/",
    kind: "html",
    endpoint: "https://deepmind.google/blog/",
    articlePath: /^https:\/\/deepmind\.google\/blog\/.+/i,
    aliases: ["Google DeepMind", "Gemini", "Gemma", "AlphaFold"],
  },
  {
    key: "nvidia-newsroom",
    name: "NVIDIA Newsroom",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 85,
    homepage: "https://nvidianews.nvidia.com/news/latest",
    kind: "rss",
    endpoint: "https://nvidianews.nvidia.com/rss",
    articlePath: /^https:\/\/nvidianews\.nvidia\.com\/news\/.+/i,
    aliases: ["NVIDIA", "CUDA", "NIM", "DGX"],
  },
  {
    key: "microsoft-ai",
    name: "Microsoft AI / Official Blog",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 85,
    homepage: "https://blogs.microsoft.com/ai/",
    kind: "html",
    endpoint: "https://blogs.microsoft.com/ai/",
    articlePath: /^https:\/\/blogs\.microsoft\.com\/(ai|blog)\/.+/i,
    aliases: ["Microsoft", "Azure AI", "Copilot", "Phi"],
  },
  {
    key: "qwen-blog",
    name: "Qwen 官方博客",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://qwenlm.github.io/blog/",
    kind: "html",
    endpoint: "https://qwenlm.github.io/blog/",
    articlePath: /^https:\/\/qwenlm\.github\.io\/blog\/.+/i,
    aliases: ["Qwen", "通义千问", "Alibaba", "AI", "大模型"],
  },
  {
    key: "deepseek-official",
    name: "DeepSeek 官方信息",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://www.deepseek.com/",
    kind: "html",
    endpoint: "https://www.deepseek.com/",
    articlePath: /^https:\/\/www\.deepseek\.com\/.+/i,
    aliases: ["DeepSeek", "深度求索", "AI", "大模型"],
  },
  {
    key: "minimax-news",
    name: "MiniMax 官方新闻",
    category: "AI/大模型",
    coverage: "domain",
    trustLevel: "official",
    priority: 90,
    homepage: "https://www.minimax.io/news",
    kind: "html",
    endpoint: "https://www.minimax.io/news",
    articlePath: /^https:\/\/www\.minimax\.io\/news\/.+/i,
    aliases: ["MiniMax", "海螺", "AI", "大模型"],
  },
];

// 保留旧名称，避免独立采集脚本或外部部署脚本在升级期间中断。
export const HIGH_VALUE_INTELLIGENCE_SOURCES = TRUSTED_INTELLIGENCE_SOURCES;

export function sourceByKey(key: string): IntelligenceSourceDefinition | undefined {
  return TRUSTED_INTELLIGENCE_SOURCES.find((source) => source.key === key);
}

export function sourceTags(source: IntelligenceSourceDefinition): string[] {
  return [...new Set([source.category, source.coverage, source.trustLevel, ...source.aliases])];
}
