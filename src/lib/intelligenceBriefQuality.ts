/**
 * 情报简报质量层：事实标题、发布时间、摘要、投资观察、去重、趋势、概览。
 * 不负责联网搜索；仅基于已有候选做表达与分桶。
 */
import type { Candidate, IntelligenceTaskInput } from "@/lib/intelligence";

const HYPE_TITLE_PATTERNS = [
  /持续爆发/, /迎来新一轮/, /估值拐点/, /进入新时代/, /全面爆发/, /风口来临/,
  /强势崛起/, /颠覆式/, /史无前例/, /必将/, /有望重塑/, /开启新纪元/,
  /狂飙/, /爆发式增长/, /迎来春天/, /黄金时代/,
];

const FACT_MARKERS = /融资|并购|收购|授权|交易|合作|收购|获批|获批|收购|首付款|轮融资|政策|监管|批准|签约|达成|完成|发布|公告|投资|收购|BD|licensing|收购|管线|适应症|金额|亿元|万美元|亿美元/;
const CLUE_MARKERS = /或将|有望|据传|消息称|业内人士|知情人士|传闻|可能|预计会|分析认为/;
const INVESTMENT_SIGNAL = /首付款|总金额|授权|BD|licensing|融资|轮次|估值|监管|政策|管线|权益|区域|共同开发|联合开发|买方|连续|多家/;

export function isHypeTitle(title: string): boolean {
  return HYPE_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

/** 压缩为事实标题：去掉无法由来源证明的判断性措辞。 */
export function sanitizeFactTitle(title: string, snippet = ""): string {
  const originalHype = isHypeTitle(title);
  let next = title.trim().replace(/\s+/g, " ");
  for (const pattern of HYPE_TITLE_PATTERNS) next = next.replace(pattern, "");
  next = next.replace(/[，,、\s]{2,}/g, "，").replace(/^[\s，,、：:]+|[\s，,、：:]+$/g, "").trim();
  if (originalHype || !next || next.length < 6 || !FACT_MARKERS.test(next)) {
    const fromSnippet = extractLeadFact(snippet);
    if (fromSnippet) return fromSnippet.slice(0, 80);
  }
  return (next || title).slice(0, 80);
}

function extractLeadFact(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const sentence = cleaned.split(/[。！？\n]/).map((part) => part.trim()).find((part) => FACT_MARKERS.test(part) && part.length >= 8);
  return sentence ? sentence.slice(0, 80) : null;
}

/**
 * 解析发布时间。collectedAt / generatedAt 绝不可冒充事件时间。
 * 返回 ISO 字符串或 null（时间未确认）。
 */
export function resolvePublishedAt(options: {
  sourcePublishedAt?: string | null;
  url?: string | null;
  collectedAt?: string | null;
  generatedAt?: string | null;
}): { publishedAt: string | null; timeUnconfirmed: boolean } {
  const fromSource = parseLooseDate(options.sourcePublishedAt);
  if (fromSource) return { publishedAt: fromSource, timeUnconfirmed: false };
  const fromUrl = options.url ? dateFromUrl(options.url) : null;
  if (fromUrl) return { publishedAt: fromUrl, timeUnconfirmed: false };
  // 明确忽略 collectedAt / generatedAt
  void options.collectedAt;
  void options.generatedAt;
  return { publishedAt: null, timeUnconfirmed: true };
}

export function dateFromUrl(value: string): string | null {
  const match = value.match(/(?:^|[^0-9])(20\d{2})[-_/](\d{2})[-_/](\d{2})(?:[^0-9]|$)|(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (!match) return null;
  const year = Number(match[1] ?? match[4]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[6]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

function parseLooseDate(value?: string | null): string | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  const asDate = new Date(raw);
  if (Number.isFinite(asDate.getTime())) return asDate.toISOString();
  const match = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

export function formatPublishedLabel(publishedAt: string | null, timeUnconfirmed?: boolean): string {
  if (timeUnconfirmed || !publishedAt) return "时间未确认";
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return "时间未确认";
  return date.toLocaleDateString("zh-CN");
}

/** 仅保留来源可支持的事实摘要；模糊单一来源降级为线索。 */
export function buildFactSummary(title: string, snippet: string, options?: { sourceCount?: number }): { summary: string; isClue: boolean } {
  const text = (snippet || title || "").replace(/\s+/g, " ").trim();
  const sourceCount = options?.sourceCount ?? 1;
  const concrete = FACT_MARKERS.test(`${title} ${text}`);
  const vague = CLUE_MARKERS.test(text) && !/公告|披露|官方/.test(text);
  const isClue = (!concrete && sourceCount <= 1) || (vague && sourceCount <= 1);

  let summary = "";
  if (text && text !== title) {
    const sentences = text.split(/[。！？\n]/).map((part) => part.trim()).filter(Boolean);
    const kept = sentences.filter((sentence) => {
      if (isHypeTitle(sentence)) return false;
      if (/符合你的关注主题|直接匹配本次关注/.test(sentence)) return false;
      return true;
    }).slice(0, 2);
    summary = kept.join("。");
    if (summary && !/[。！？]$/.test(summary)) summary += "。";
  }
  if (!summary) {
    summary = concrete ? `${sanitizeFactTitle(title, text)}。` : `公开信息提到：${sanitizeFactTitle(title, text)}。`;
  }
  if (isClue) {
    summary = summary.replace(/^/, "").trim();
    if (!/线索|待确认|据/.test(summary)) summary = `线索：${summary.replace(/^线索：/, "")}`;
  }
  return { summary: summary.slice(0, 360), isClue };
}

/**
 * 仅在能从事实推出投资含义时生成“投资观察”。
 * 禁止输出“符合你的关注主题”类空话。
 */
export function buildInvestmentNote(candidate: Pick<Candidate, "title" | "content"> & { summary?: string }, _input?: IntelligenceTaskInput): string | null {
  const text = `${candidate.title} ${candidate.summary ?? ""} ${candidate.content}`.replace(/\s+/g, " ");
  if (/符合你的关注主题|直接匹配本次关注主题/.test(text)) return null;
  if (!INVESTMENT_SIGNAL.test(text)) return null;

  const notes: string[] = [];
  if (/首付款|总金额|美元|亿元|万美元|亿美元/.test(text) && /授权|BD|licensing|交易|合作/.test(text)) {
    notes.push("关注交易对价结构（首付款/里程碑/总金额）对同类管线估值的参照意义");
  }
  if (/授权|BD|licensing|权益/.test(text) && /海外|全球|美国|欧洲|日本|区域/.test(text)) {
    notes.push("关注授权区域与权益拆分，判断出海路径是区域授权还是更大范围合作");
  }
  if (/共同开发|联合开发|联营/.test(text)) {
    notes.push("若由单纯 licensing-out 转向共同开发，通常意味着能力边界与风险分担方式变化");
  }
  if (/融资|轮|估值/.test(text) && /航天|商业航天|生物|创新药|AI|半导体|机器人/.test(text)) {
    notes.push("关注融资轮次与投资方构成，判断该赛道资金是否仍在集中下注");
  }
  if (/政策|监管|获批|批准|集采|医保/.test(text)) {
    notes.push("监管/政策动作可能改变融资与商业化预期，需对照落地细则");
  }
  if (/连续|多家|再次|又一家/.test(text) && /买方|药企|基金|投资/.test(text)) {
    notes.push("同一买方或同类买方连续出手时，更值得跟踪其选型偏好是否固化");
  }
  if (!notes.length) return null;
  return notes[0]!;
}

export function eventThemeKey(title: string, content = ""): string {
  const text = `${title} ${content}`;
  if (/BD|授权|licensing|引进|对外授权/.test(text)) return "bd-licensing";
  if (/融资|轮|估值|投资额/.test(text)) return "financing";
  if (/并购|收购|收购/.test(text)) return "mna";
  if (/政策|监管|获批|批准/.test(text)) return "policy";
  if (/发布|产品|型号|发射/.test(text)) return "product";
  const tokens = title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length > 1).slice(0, 4);
  return tokens.join("|") || compactTitle(title).slice(0, 24);
}

function compactTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function titleTokens(title: string): Set<string> {
  return new Set(title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length > 1));
}

/** 转载合并：同底层事件只保留一张卡片，聚合来源。 */
export function mergeEventCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const tokens = titleTokens(candidate.title);
    const existing = merged.find((item) => {
      const aTime = item.timeUnconfirmed ? null : Date.parse(item.publishedAt);
      const bTime = candidate.timeUnconfirmed ? null : Date.parse(candidate.publishedAt);
      if (aTime && bTime && Math.abs(aTime - bTime) / 86400000 > 14) return false;
      if (item.sourceUrl && candidate.sourceUrl && item.sourceUrl === candidate.sourceUrl) return true;
      const compactA = compactTitle(item.title);
      const compactB = compactTitle(candidate.title);
      if (compactA === compactB || (compactA.length > 8 && compactB.length > 8 && (compactA.includes(compactB) || compactB.includes(compactA)))) return true;
      const themeA = eventThemeKey(item.title, item.content);
      const themeB = eventThemeKey(candidate.title, candidate.content);
      const other = titleTokens(item.title);
      const overlap = [...tokens].filter((token) => other.has(token)).length;
      const ratio = overlap / Math.max(2, Math.min(tokens.size, other.size));
      if (themeA === themeB && themeA !== compactTitle(item.title).slice(0, 24) && overlap >= 2 && ratio >= 0.4) return true;
      return overlap >= 2 && ratio >= 0.55;
    });
    if (!existing) {
      merged.push({
        ...candidate,
        sourceUrls: candidate.sourceUrl ? [candidate.sourceUrl] : [...(candidate.sourceUrls ?? [])],
      });
      continue;
    }
    const urls = [...new Set([...(existing.sourceUrls ?? []), ...(candidate.sourceUrls ?? []), existing.sourceUrl, candidate.sourceUrl].filter((url): url is string => !!url))];
    existing.sourceUrls = urls;
    existing.source = [...new Set(`${existing.source}; ${candidate.source}`.split(/;\s*/).filter(Boolean))].join("; ");
    if (candidate.sourceTier === "A" || (candidate.sourceTier === "B" && existing.sourceTier !== "A")) {
      existing.sourceTier = candidate.sourceTier;
      if (!existing.timeUnconfirmed && candidate.timeUnconfirmed === false && candidate.sourceTier === "A") {
        existing.title = candidate.title;
        existing.content = candidate.content;
        existing.summary = candidate.summary ?? existing.summary;
      }
    }
    if (!existing.timeUnconfirmed && candidate.timeUnconfirmed) {
      /* keep confirmed time */
    } else if (existing.timeUnconfirmed && !candidate.timeUnconfirmed) {
      existing.publishedAt = candidate.publishedAt;
      existing.timeUnconfirmed = false;
    }
    if ((candidate.sourceUrls?.length ?? 0) + 1 > 1 || urls.length > 1) {
      existing.confidence = existing.confidence === "low" ? "medium" : existing.confidence;
      if (existing.isClue && urls.length > 1 && FACT_MARKERS.test(existing.title)) existing.isClue = false;
    }
    if (candidate.kind === "fact" && existing.kind !== "fact") existing.kind = "fact";
  }
  return merged;
}

/** 单篇新闻不得单独成为趋势；至少 2 个独立事件指向同一变化。 */
export function partitionBriefItems(candidates: Candidate[]): {
  importantFacts: Candidate[];
  trendSignals: Candidate[];
  otherItems: Candidate[];
} {
  const facts: Candidate[] = [];
  const others: Candidate[] = [];
  for (const item of candidates) {
    if (item.isClue || item.importance === "low" || item.kind === "other") others.push(item);
    else facts.push(item);
  }

  const groups = new Map<string, Candidate[]>();
  for (const item of facts) {
    const key = eventThemeKey(item.title, item.summary ?? item.content);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const trendSignals: Candidate[] = [];
  const used = new Set<string>();
  for (const [theme, group] of groups) {
    if (group.length < 2) continue;
    if (theme.length < 3) continue;
    const urls = [...new Set(group.flatMap((item) => item.sourceUrls?.length ? item.sourceUrls : item.sourceUrl ? [item.sourceUrl] : []))];
    const domains = new Set(group.map((item) => item.domain || item.source).filter(Boolean));
    if (domains.size < 2 && urls.length < 2) continue;
    const titles = group.slice(0, 3).map((item) => item.title).join("；");
    const trend: Candidate = {
      id: `trend:${theme}:${group[0]!.id}`,
      title: trendTitleFor(theme, group),
      content: `本期至少有 ${group.length} 条独立动态共同指向相关变化：${titles}。`,
      summary: `本期至少有 ${group.length} 条独立动态共同指向相关变化：${titles}。`,
      source: group.map((item) => item.source).join("; "),
      sourceUrl: group[0]!.sourceUrl,
      sourceUrls: urls,
      publishedAt: group.find((item) => !item.timeUnconfirmed)?.publishedAt || group[0]!.publishedAt,
      timeUnconfirmed: group.every((item) => item.timeUnconfirmed),
      subject: theme,
      region: null,
      kind: "trend",
      importance: "medium",
      relevance: "high",
      confidence: urls.length > 1 ? "high" : "medium",
      origin: group[0]!.origin,
      investmentNote: buildInvestmentNote({ title: trendTitleFor(theme, group), content: titles, summary: titles }) || undefined,
    };
    trendSignals.push(trend);
    for (const item of group) used.add(item.id);
  }

  const importantFacts = facts.filter((item) => !used.has(item.id) && item.importance !== "low");
  const leftover = facts.filter((item) => used.has(item.id) ? false : item.importance === "low");
  return {
    importantFacts,
    trendSignals,
    otherItems: [...others, ...leftover],
  };
}

function trendTitleFor(theme: string, group: Candidate[]): string {
  if (theme === "bd-licensing") return "海外授权/BD 交易出现多笔呼应";
  if (theme === "financing") return "相关融资动态在本期连续出现";
  if (theme === "mna") return "并购与资本运作信号增多";
  if (theme === "policy") return "政策与监管动作形成组合影响";
  if (theme === "product") return "产品/项目进展在本期多点出现";
  return `${sanitizeFactTitle(group[0]!.title)}等动态形成组合观察`;
}

export function buildEditorialOverview(candidates: Candidate[], input: IntelligenceTaskInput): string {
  if (!candidates.length) return "本期未发现符合条件、且可核验的新增事实。";
  const top = candidates.filter((item) => !item.isClue).slice(0, 3);
  const names = top.map((item) => sanitizeFactTitle(item.title, item.summary ?? item.content));
  const themes = [...new Set(top.map((item) => eventThemeKey(item.title, item.summary ?? item.content)))];
  const topic = [...input.topics, ...input.entities].filter(Boolean).slice(0, 2).join("、") || input.name;
  const parts: string[] = [];
  if (names.length >= 2) {
    parts.push(`本期「${topic}」仍有可跟踪进展，优先关注 ${names.slice(0, 2).join("，")}。`);
  } else if (names.length === 1) {
    parts.push(`本期「${topic}」较明确的新增事实是：${names[0]}。`);
  } else {
    parts.push(`本期「${topic}」多为待确认线索，尚不足以形成可靠判断。`);
  }
  if (themes.includes("bd-licensing") && top.length >= 2) {
    parts.push("相比单纯标题热度，更值得看交易结构、管线资产与授权区域是否出现新的组合方式。");
  } else if (themes.includes("financing") && top.length >= 2) {
    parts.push("融资类信息需核对轮次、金额与投资方，避免把转载当成多笔独立交易。");
  } else if (top.length === 1) {
    parts.push("目前事件样本量有限，先核对事实本身，不强行外推趋势。");
  }
  return parts.join("");
}

export function enrichCandidate(
  candidate: Candidate,
  input: IntelligenceTaskInput,
): Candidate {
  const sourceCount = Math.max(1, candidate.sourceUrls?.length ?? (candidate.sourceUrl ? 1 : 1));
  const title = sanitizeFactTitle(candidate.title, candidate.content);
  const { summary, isClue } = buildFactSummary(title, candidate.content, { sourceCount });
  const investmentNote = isClue ? null : buildInvestmentNote({ title, content: candidate.content, summary }, input);
  const confidence: Candidate["confidence"] =
    sourceCount > 1 || candidate.sourceTier === "A"
      ? "high"
      : isClue || candidate.timeUnconfirmed
        ? "low"
        : candidate.sourceTier === "B" || candidate.sourceTier === "C"
          ? "medium"
          : "low";
  return {
    ...candidate,
    title,
    summary,
    content: summary,
    investmentNote: investmentNote || undefined,
    isClue,
    kind: isClue ? "other" : "fact",
    confidence,
  };
}

export function scoreAndSortCandidates(candidates: Candidate[], input: IntelligenceTaskInput): Candidate[] {
  const terms = [...input.topics, ...input.entities, ...input.keywords, ...input.includeRequirements].filter(Boolean);
  return candidates.map((candidate) => {
    const text = `${candidate.title} ${candidate.summary ?? ""} ${candidate.content}`.toLocaleLowerCase();
    const hits = terms.filter((term) => text.includes(term.toLocaleLowerCase())).length;
    const relevance: Candidate["relevance"] = hits >= 2 ? "high" : hits === 1 ? "medium" : "low";
    const concrete = FACT_MARKERS.test(candidate.title) || FACT_MARKERS.test(candidate.summary ?? "");
    const importance: Candidate["importance"] = candidate.isClue
      ? "low"
      : concrete && (candidate.sourceTier === "A" || (candidate.sourceUrls?.length ?? 0) > 1)
        ? "high"
        : concrete
          ? "medium"
          : "low";
    const confidence: Candidate["confidence"] =
      candidate.sourceTier === "A" || (candidate.sourceUrls?.length ?? 0) > 1
        ? "high"
        : candidate.timeUnconfirmed || candidate.isClue
          ? "low"
          : candidate.sourceTier === "B" || candidate.sourceTier === "C"
            ? "medium"
            : "low";
    const kind: Candidate["kind"] = candidate.isClue ? "other" : candidate.kind === "trend" ? "trend" : "fact";
    return { ...candidate, relevance, importance, confidence, kind };
  }).sort((a, b) => {
    const rank = (value?: "high" | "medium" | "low") => (value === "high" ? 3 : value === "medium" ? 2 : 1);
    const tier = (value?: "A" | "B" | "C" | "D") => (value === "A" ? 4 : value === "B" ? 3 : value === "C" ? 2 : 1);
    const multi = (item: Candidate) => (item.sourceUrls?.length ?? (item.sourceUrl ? 1 : 0));
    const fresh = (item: Candidate) => (item.timeUnconfirmed ? 0 : Date.parse(item.publishedAt) || 0);
    return (
      rank(b.importance) - rank(a.importance)
      || rank(b.relevance) - rank(a.relevance)
      || tier(b.sourceTier) - tier(a.sourceTier)
      || multi(b) - multi(a)
      || fresh(b) - fresh(a)
    );
  });
}
