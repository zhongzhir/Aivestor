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
  // ── 权威来源（S2）──────────────────────────────────────────────
  // 面向股权投资研究：让相关任务（IPO/并购/监管/政策等）在搜索侧通过
  // assigned_site_list 锁定这些权威域，并维持 S 级来源标记。
  // 专业媒体（Reuters/36氪/财新等）保持 A 级（见 sourceQuality），不在此升级。
  // 交易所/监管站点多为 JS 渲染，采集侧（RSS/HTML 正则）可能仅部分可用，
  // 抓取失败由采集器逐源容错，不影响搜索侧生效。
  {
    key: "sse-announcements",
    name: "上海证券交易所",
    category: "交易所/监管",
    coverage: "general",
    trustLevel: "regulatory",
    priority: 95,
    homepage: "https://www.sse.com.cn/",
    kind: "html",
    endpoint: "https://www.sse.com.cn/",
    articlePath: /^https:\/\/www\.sse\.com\.cn\/.+/i,
    aliases: ["上交所", "上海证券交易所", "SSE", "科创板", "沪市", "IPO"],
  },
  {
    key: "szse-announcements",
    name: "深圳证券交易所",
    category: "交易所/监管",
    coverage: "general",
    trustLevel: "regulatory",
    priority: 95,
    homepage: "https://www.szse.cn/",
    kind: "html",
    endpoint: "https://www.szse.cn/",
    articlePath: /^https:\/\/www\.szse\.cn\/.+/i,
    aliases: ["深交所", "深圳证券交易所", "SZSE", "创业板", "深市"],
  },
  {
    key: "hkex-announcements",
    name: "香港交易所",
    category: "交易所/监管",
    coverage: "general",
    trustLevel: "regulatory",
    priority: 95,
    homepage: "https://www.hkex.com.hk/",
    kind: "html",
    endpoint: "https://www.hkex.com.hk/",
    articlePath: /^https:\/\/www\.hkex\.com\.hk\/.+/i,
    aliases: ["港交所", "香港交易所", "HKEX", "港股", "港股IPO"],
  },
  {
    key: "csrc-regulatory",
    name: "中国证监会",
    category: "交易所/监管",
    coverage: "general",
    trustLevel: "regulatory",
    priority: 95,
    homepage: "https://www.csrc.gov.cn/",
    kind: "html",
    endpoint: "https://www.csrc.gov.cn/",
    articlePath: /^https:\/\/www\.csrc\.gov\.cn\/.+/i,
    aliases: ["证监会", "中国证监会", "CSRC", "监管", "政策"],
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
