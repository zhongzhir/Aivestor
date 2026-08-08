/**
 * 情报搜索来源质量配置。只用于运行时排序与展示，不进入数据库。
 * S 为第一事实源，A 为严格限定的高质量媒体，B 为一般可信媒体，C 为线索来源。
 */
export type SourceQualityTier = "S" | "A" | "B" | "C";

export const SOURCE_QUALITY_REGISTRY = {
  A: [
    "reuters.com", "36kr.com", "huxiu.com", "cls.cn", "yicai.com",
    "jiemian.com", "stcn.com", "cnstock.com", "thepaper.cn",
  ],
  B: ["sina.com.cn", "eastmoney.com", "163.com", "sohu.com"],
  C: ["xueqiu.com", "weibo.com", "雪球", "财富号"],
} as const;

export const HIGH_QUALITY_MEDIA_DOMAINS = [...SOURCE_QUALITY_REGISTRY.A];

function normalizeDomain(value: string): string {
  return value.toLocaleLowerCase().replace(/^www\./, "").trim();
}

export function domainFromUrl(value: string): string {
  try { return normalizeDomain(new URL(value).hostname); } catch { return ""; }
}

function domainMatches(domain: string, registered: string): boolean {
  return domain === registered || domain.endsWith(`.${registered}`);
}

export function sourceQualityForDomain(domainOrUrl: string, sourceName = ""): SourceQualityTier {
  const domain = domainOrUrl.includes("://") ? domainFromUrl(domainOrUrl) : normalizeDomain(domainOrUrl);
  const name = sourceName.toLocaleLowerCase();
  // 直接当事方/政府、监管、交易所等第一事实源。
  if (
    /(?:^|\.)gov\.cn$/.test(domain)
    || /(?:^|\.)gov\.hk$/.test(domain)
    || /(?:^|\.)csrc\.gov\.cn$/.test(domain)
    || /(?:^|\.)sse\.com\.cn$/.test(domain)
    || /(?:^|\.)szse\.cn$/.test(domain)
    || /(?:^|\.)hkex\.com\.hk$/.test(domain)
    || /官方公告|公司公告|政府|监管|交易所/.test(name)
  ) return "S";
  if (SOURCE_QUALITY_REGISTRY.A.some((item) => domainMatches(domain, item))) return "A";
  if (SOURCE_QUALITY_REGISTRY.B.some((item) => domainMatches(domain, item))) return "B";
  if (SOURCE_QUALITY_REGISTRY.C.some((item) => domainMatches(domain, item)) || /雪球|财富号|微博|论坛|自媒体|股吧/.test(name)) return "C";
  return "C";
}

export function sourceQualityRank(tier?: SourceQualityTier | "D"): number {
  return tier === "S" ? 4 : tier === "A" ? 3 : tier === "B" ? 2 : 1;
}

export function primarySourceRank(tier?: SourceQualityTier | "D"): number {
  return sourceQualityRank(tier);
}

export function sourceQualityLabel(tier?: SourceQualityTier | "D"): string {
  return tier === "S" ? "第一事实源" : tier === "A" ? "高质量媒体" : tier === "B" ? "一般可信媒体" : "线索来源";
}
