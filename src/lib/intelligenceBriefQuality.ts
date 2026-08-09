/**
 * 情报简报质量层：事实标题、发布时间、摘要、投资观察、去重、趋势、概览。
 * 不负责联网搜索；仅基于已有候选做表达与分桶。
 */
import type { Candidate, IntelligenceTaskInput } from "@/lib/intelligence";
import { sourceQualityRank } from "@/lib/intelligenceSourceQuality";
import { normalizePublicTimestamp } from "@/lib/intelligenceTime";

const HYPE_DETECT_PATTERNS = [
  /持续爆发/, /迎来新一轮/, /估值拐点/, /进入新时代/, /全面爆发/, /风口来临/,
  /强势崛起/, /颠覆式/, /史无前例/, /必将/, /有望重塑/, /开启新纪元/,
  /狂飙/, /爆发式增长/, /迎来春天/, /黄金时代/, /暴增\d*%?/, /狂揽/, /杀出/,
  /海外重围/, /真拐点/, /价值重估/, /绝不错过/, /大热门/, /一触即发/, /万亿市场/,
  /资本盛宴/, /资本狂热/, /疯狂突破/, /彻底拆解/, /利好共振/, /表现十分亮眼/,
  /业绩亮眼/, /迎来新时代/, /重塑/, /卡位/, /争夺战/, /成人礼/, /大消息!?/,
  /迎来窗口/, /亮眼/, /爆发/, /前所未有/, /抢滩/, /重新定义/, /吸金/, /开门红/, /加速跑/,
];

/** 清洗时可删除的编辑腔后缀；不单独作为 hype 判定依据（避免误伤事实标题）。 */
const HYPE_STRIP_EXTRA = [/拷问.+$/, /背后[,:：，].*$/, /陷[^:：，,。]*罗生门/, /开门红[!！]?/, /加速跑/, /创新高/, /[|｜].*$/, /[，,：:].*$/];

const HYPE_TITLE_PATTERNS = [...HYPE_DETECT_PATTERNS, ...HYPE_STRIP_EXTRA];

const OPINION_MARKERS = /如何重估|还是真|吗\?|吗？|背后是|talk秀|周报\s*\|+|发展到哪一步|参与者几何|全梳理|最新动向曝光/;

const FACT_MARKERS = /融资|并购|收购|授权|交易|合作|上市|获批|批准|签约|达成|完成|发布|公告|投资|首付款|轮融资|政策|监管|BD|licensing|管线|适应症|金额|亿元|万美元|亿美元|投保|补贴|立案|协议|一药两授|互诉|诉讼|权益/;
const CONCRETE_EVENT_ACTIONS = /完成|推进|计划|重启|寻求|被曝|宣布|达成|签署|签约|获批|批准|启动|披露|拟|收购|并购|投资|融资|募资|上市|IPO|授权|BD|licensing/;
const CONCRETE_EVENT_DETAILS = /\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币)|[一二三四五六七八九十]+轮|[A-D]轮|Pre-?IPO|投资方|买方|交易对手|官方公告|公司公告|监管文件|权益区域/;
const GENERIC_EVENT_SUBJECTS = /^(?:AI|AIGC|人工智能|大模型|资本|行业|市场|企业|公司|机构|融资|投资|交易|并购|中国AI|AI行业|头部大模型)$/i;
const CLUE_MARKERS = /或将|有望|据传|消息称|业内人士|知情人士|传闻|可能|预计会|分析认为/;
const INVESTMENT_SIGNAL = /首付款|总金额|授权|BD|licensing|融资|轮次|估值|监管|政策|管线|权益|区域|共同开发|联合开发|买方|连续|多家/;
const EXTERNAL_INSTRUCTION = /ignore\s+(?:all\s+)?previous\s+instructions?|system\s+prompt|api\s*key|忽略(?:以上|之前)指令|系统提示词|打印.*(?:提示词|密钥)|输出.*(?:API\s*Key|密钥)/i;

function removeExternalInstructions(text: string): string {
  return text
    .split(/[。！？\n.!?]+/)
    .map((part) => part
      .replace(/ignore\s+(?:all\s+)?previous\s+instructions?/gi, "")
      .replace(/print\s+(?:the\s+)?(?:system\s+prompt|api\s*key)/gi, "")
      .replace(/(?:system\s+prompt|api\s*key)/gi, "")
      .replace(/忽略(?:以上|之前)指令|打印.*?(?:提示词|密钥)|输出.*?(?:API\s*Key|密钥)/gi, "")
      .trim())
    .filter((part) => part && !EXTERNAL_INSTRUCTION.test(part))
    .join("。")
    .trim();
}

export function isHypeTitle(title: string): boolean {
  return HYPE_DETECT_PATTERNS.some((pattern) => pattern.test(title));
}

export function isOpinionTitle(title: string): boolean {
  return OPINION_MARKERS.test(title) || /[？?]$/.test(title.trim());
}

/** 压缩为事实标题：去掉无法由来源证明的判断性措辞。 */
export function sanitizeFactTitle(title: string, snippet = ""): string {
  const originalHype = isHypeTitle(title);
  let next = title.trim().replace(/\s+/g, " ");
  for (const pattern of HYPE_TITLE_PATTERNS) next = next.replace(pattern, "");
  next = next
    .replace(/[“”""]{2,}/g, "")
    .replace(/[“”""]\s*[“”""]/g, "")
    .replace(/[，,、\s]{2,}/g, "，")
    .replace(/^[\s，,、：:!！?？]+|[\s，,、：:!！?？]+$/g, "")
    .trim();
  next = next
    .replace(/^\d+[.。)、]\s*/, "")
    .replace(/正经历(?:的)?(?:涨价与)?融资双重/, "融资")
    .replace(/加速资本/, "资本动向");
  if (EXTERNAL_INSTRUCTION.test(title) || originalHype || isOpinionTitle(title) || !next || next.length < 6 || !FACT_MARKERS.test(next)) {
    const fromSnippet = extractLeadFact(snippet);
    if (fromSnippet) return fromSnippet.slice(0, 80);
  }
  if (isHypeTitle(next) || isOpinionTitle(next)) {
    const fromSnippet = extractLeadFact(snippet);
    if (fromSnippet) return fromSnippet.slice(0, 80);
    return next.slice(0, 80);
  }
  return (next || title).slice(0, 80);
}

function extractLeadFact(text: string): string | null {
  const cleaned = removeExternalInstructions(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const sentence = cleaned.split(/[。！？\n.!?]/).map((part) => part.trim()).find((part) => FACT_MARKERS.test(part) && !isHypeTitle(part) && part.length >= 8);
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
  const fromUrl = options.url ? normalizePublicTimestamp(dateFromUrl(options.url)) : null;
  if (fromUrl) return { publishedAt: fromUrl, timeUnconfirmed: false };
  // 明确忽略 collectedAt / generatedAt
  void options.collectedAt;
  void options.generatedAt;
  return { publishedAt: null, timeUnconfirmed: true };
}

export function dateFromUrl(value: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();

  const queryDate = decoded.match(/[?&]date=(20\d{2})[/\-.]?(\d{1,2})[/\-.]?(\d{1,2})/i);
  if (queryDate) return ymdToIso(Number(queryDate[1]), Number(queryDate[2]), Number(queryDate[3]));

  const dashed = decoded.match(/(?:^|[^0-9])(20\d{2})[-_/](\d{2})[-_/](\d{2})(?:[^0-9]|$)/);
  if (dashed) return ymdToIso(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));

  // /2026/0125/ 或 /2025/1231/（月日连写）
  const ymdCompact = decoded.match(/(?:^|[^0-9])(20\d{2})[/_-](\d{2})(\d{2})(?:[^0-9]|$)/);
  if (ymdCompact) return ymdToIso(Number(ymdCompact[1]), Number(ymdCompact[2]), Number(ymdCompact[3]));

  // 东方财富等：/a/202601093613245216.html → 取前 8 位日期
  const compact = decoded.match(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?=\d{3,}|[./_-]|$)/);
  if (compact) return ymdToIso(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  return null;
}

function ymdToIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

function parseLooseDate(value?: string | null): string | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  const asDate = new Date(raw);
  if (Number.isFinite(asDate.getTime())) return normalizePublicTimestamp(asDate.toISOString());
  const match = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  return normalizePublicTimestamp(ymdToIso(Number(match[1]), Number(match[2]), Number(match[3])));
}

export function formatPublishedLabel(publishedAt: string | null, timeUnconfirmed?: boolean): string {
  if (timeUnconfirmed || !publishedAt) return "时间未确认";
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return "时间未确认";
  return date.toLocaleDateString("zh-CN");
}

/** 仅保留来源可支持的事实摘要；模糊单一来源降级为线索。 */
export function buildFactSummary(title: string, snippet: string, options?: { sourceCount?: number; forceClue?: boolean; trustedSource?: boolean; preserveSummaryWhenSanitized?: boolean }): { summary: string; isClue: boolean } {
  const text = removeExternalInstructions(snippet || title || "").replace(/\s+/g, " ").trim();
  const sourceCount = options?.sourceCount ?? 1;
  const concrete = FACT_MARKERS.test(`${title} ${text}`) && !isHypeTitle(title) && !isOpinionTitle(title);
  const vague = CLUE_MARKERS.test(text) && !/公告|披露|官方/.test(text);
  const softClaim = isHypeTitle(title) || isOpinionTitle(title) || /亮眼|共振|重围|狂揽|暴增/.test(`${title} ${text}`);
  const titleOnly = text === title.trim() || text.length < title.trim().length + 20;
  const isClue = !!options?.forceClue || softClaim || (!concrete && sourceCount <= 1) || (vague && sourceCount <= 1) || (titleOnly && sourceCount <= 1 && !options?.trustedSource);

  let summary = "";
  if (text && text !== title) {
    const sentences = text.split(/[。！？\n]/).map((part) => part.trim()).filter(Boolean);
    const kept = sentences.filter((sentence) => {
      if (EXTERNAL_INSTRUCTION.test(sentence)) return false;
      if (isHypeTitle(sentence)) return false;
      if (/符合你的关注主题|直接匹配本次关注/.test(sentence)) return false;
      return true;
    }).slice(0, 2);
    summary = kept.join("。");
    if (summary && !/[。！？]$/.test(summary)) summary += "。";
  }
  if (!summary) {
    summary = "";
  }
  if (!options?.preserveSummaryWhenSanitized && summary && compactTitle(summary.replace(/^线索：/, "")) === compactTitle(title)) summary = "";
  if (isClue && summary && !/线索|待确认|据/.test(summary)) {
    summary = `线索：${summary.replace(/^线索：/, "")}`;
  }
  return { summary: summary.slice(0, 360), isClue };
}

/**
 * 仅在能从事实推出投资含义时生成“投资观察”。
 * 禁止输出“符合你的关注主题”类空话；必须能挂到具体事实增量。
 */
export function buildInvestmentNote(candidate: Pick<Candidate, "title" | "content"> & { summary?: string }, _input?: IntelligenceTaskInput): string | null {
  const text = `${candidate.title} ${candidate.summary ?? ""} ${candidate.content}`.replace(/\s+/g, " ");
  if (/符合你的关注主题|直接匹配本次关注主题/.test(text)) return null;
  if (isHypeTitle(candidate.title) || isOpinionTitle(candidate.title)) return null;
  if (!INVESTMENT_SIGNAL.test(text)) return null;

  const hasConcreteAnchor =
    /首付款|总金额|亿美元|万美元|亿元|轮融资|A轮|B轮|C轮|Pre-IPO|授权区域|全球权益|美国权益|欧洲|共同开发|联合开发|立案|投保|补贴/.test(text)
    || (/授权|BD|licensing/.test(text) && /海外|全球|美国|欧洲|日本|区域/.test(text));
  if (!hasConcreteAnchor) return null;

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
  if (/融资|轮|估值/.test(text) && /航天|商业航天|生物|创新药|AI|半导体|机器人/.test(text) && /亿元|万美元|亿美元|A轮|B轮|C轮|Pre-IPO/.test(text)) {
    notes.push("关注融资轮次与投资方构成，判断该赛道资金是否仍在集中下注");
  }
  if (/政策|监管|获批|批准|集采|医保|投保|补贴/.test(text)) {
    notes.push("监管/政策动作可能改变融资与商业化预期，需对照落地细则");
  }
  if (/连续|多家|再次|又一家/.test(text) && /买方|药企|基金|投资/.test(text)) {
    notes.push("同一买方或同类买方连续出手时，更值得跟踪其选型偏好是否固化");
  }
  if (/立案|互诉|协议碰撞|一药两授/.test(text)) {
    notes.push("授权权属争议会直接影响 BD 交易的可执行性与买方尽调标准");
  }
  if (!notes.length) return null;
  return notes[0]!;
}

/**
 * Editorial layer：把已确认事实或具体线索转成克制的判断；推断使用条件语气，
 * 不补写金额、投资方或交易条件等来源未提供的事实。
 */
export function buildEditorialCommentary(candidate: Pick<Candidate, "title" | "content"> & { summary?: string; isClue?: boolean }, _input?: IntelligenceTaskInput): string | null {
  const text = `${candidate.title} ${candidate.summary ?? ""} ${candidate.content}`.replace(/\s+/g, " ").trim();
  if (!text || isHypeTitle(candidate.title) || isOpinionTitle(candidate.title)) return null;
  if (!candidate.isClue) return buildInvestmentNote(candidate);
  if (/融资|募资|估值|轮融资|亿美元|亿元/.test(text)) return "若融资消息得到确认，将反映相关企业仍在争取较大规模资本；下一步应核对融资轮次、金额与投资方。";
  if (/授权|BD|licensing|交易|合作|签约/.test(text)) return "若交易消息得到确认，将提供管线/合作方选择的线索；下一步应核对交易对手、权益范围与付款安排。";
  if (/并购|收购|上市|IPO|股权|投资/.test(text)) return "若该资本动作得到确认，可能改变相关主体的竞争或融资条件；下一步应核对公告主体与交易进度。";
  if (/政策|监管|获批|批准|补贴|规划|通知/.test(text)) return "若政策动作得到确认，可能影响相关项目的商业化与融资预期；下一步应核对发布主体和正式文件。";
  return null;
}

/** 抽取主体，用于转载合并与趋势独立性判断。 */
export function extractEventEntity(title: string, content = ""): string | null {
  const text = `${title} ${content}`;
  const company = text.match(/([\u4e00-\u9fffA-Za-z0-9·\-]{2,20}(?:医药|制药|药业|生物|科技|航天|火箭|卫星|股份))/);
  if (company?.[1]) return company[1].replace(/\s+/g, "").toLocaleLowerCase();
  const asset = text.match(/([A-Z]{1,5}[-\s]?\d{3,5}|TY[‑\-]?\d{3,5})/i);
  if (asset?.[1]) return asset[1].replace(/\s+/g, "").toLocaleLowerCase();
  const beforeAmount = text.match(/([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9·\-]{1,20})(?=\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币))/);
  if (beforeAmount?.[1]) return beforeAmount[1].replace(/(?:完成|推进|计划|被曝|吸金|头部|中国|国内)$/g, "").trim().toLocaleLowerCase() || null;
  return null;
}

export function eventThemeKey(title: string, content = ""): string {
  const text = `${title} ${content}`;
  if (/政策|监管|获批|批准|补贴|投保|征求意见|通知|试点/.test(text) && !/BD|授权|licensing/.test(text)) return "policy";
  if (/BD|授权|licensing|引进|对外授权|一药两授|权益协议/.test(text)) return "bd-licensing";
  if (/融资|轮融资|估值|投资额|亿元融资/.test(text) && !/投融资便利化|外汇管理/.test(text)) return "financing";
  if (/并购|收购|收购/.test(text)) return "mna";
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

function sameUnderlyingEvent(a: Candidate, b: Candidate): boolean {
  const entityA = extractEventEntity(a.title, a.content);
  const entityB = extractEventEntity(b.title, b.content);
  const themeA = eventThemeKey(a.title, a.content);
  const themeB = eventThemeKey(b.title, b.content);
  if (entityA && entityB && entityA === entityB && themeA === themeB) return true;
  const amountKey = (value: string) => [...value.matchAll(/\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币)/g)].map((match) => match[0]!.replace(/\s+/g, "")).sort().join(",");
  const amountA = amountKey(`${a.title} ${a.content}`);
  const amountB = amountKey(`${b.title} ${b.content}`);
  const genericEntity = (value: string | null) => !!value && /头部|大模型|企业|公司|国内|中国/.test(value);
  if (amountA && amountA === amountB && themeA === themeB && (!entityA || !entityB || entityA === entityB || genericEntity(entityA) || genericEntity(entityB))) return true;
  if (entityA && entityB && entityA === entityB && /同源康|TY.?9591/i.test(`${a.title}${b.title}`)) return true;
  const compactA = compactTitle(a.title);
  const compactB = compactTitle(b.title);
  if (compactA === compactB || (compactA.length > 8 && compactB.length > 8 && (compactA.includes(compactB) || compactB.includes(compactA)))) return true;
  const tokens = titleTokens(a.title);
  const other = titleTokens(b.title);
  const overlap = [...tokens].filter((token) => other.has(token)).length;
  const ratio = overlap / Math.max(2, Math.min(tokens.size, other.size));
  if (themeA === themeB && entityA && entityB && entityA === entityB && overlap >= 1) return true;
  if (themeA === themeB && overlap >= 3 && ratio >= 0.45) return true;
  return overlap >= 2 && ratio >= 0.55;
}

function materialConflict(a: Candidate, b: Candidate): boolean {
  const amounts = (value: string) => [...value.matchAll(/\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币)/g)].map((match) => match[0]!.replace(/\s+/g, "")).sort();
  const left = amounts(`${a.title} ${a.content}`);
  const right = amounts(`${b.title} ${b.content}`);
  return left.length > 0 && right.length > 0 && left.some((value) => !right.includes(value)) && right.some((value) => !left.includes(value));
}

/** 转载合并：同底层事件只保留一张卡片，聚合来源。 */
export function mergeEventCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const existing = merged.find((item) => {
      const aTime = item.timeUnconfirmed ? null : Date.parse(item.publishedAt);
      const bTime = candidate.timeUnconfirmed ? null : Date.parse(candidate.publishedAt);
      if (aTime && bTime && Math.abs(aTime - bTime) / 86400000 > 14) return false;
      if (item.sourceUrl && candidate.sourceUrl && item.sourceUrl === candidate.sourceUrl) return true;
      if (materialConflict(item, candidate)) return false;
      return sameUnderlyingEvent(item, candidate);
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
    if (sourceQualityRank(candidate.sourceTier) > sourceQualityRank(existing.sourceTier)) {
      existing.sourceTier = candidate.sourceTier;
      existing.source = candidate.source;
      existing.sourceUrl = candidate.sourceUrl;
      existing.domain = candidate.domain;
      existing.title = candidate.title;
      existing.content = candidate.content;
      existing.summary = candidate.summary ?? existing.summary;
    }
    if (!existing.timeUnconfirmed && candidate.timeUnconfirmed) {
      /* keep confirmed time */
    } else if (existing.timeUnconfirmed && !candidate.timeUnconfirmed) {
      existing.publishedAt = candidate.publishedAt;
      existing.timeUnconfirmed = false;
    }
    if ((candidate.sourceUrls?.length ?? 0) + 1 > 1 || urls.length > 1) {
      existing.confidence = existing.confidence === "low" ? "medium" : existing.confidence;
    }
    if (candidate.kind === "fact" && existing.kind !== "fact") existing.kind = "fact";
  }
  return merged;
}

function isWebEvidenceVerified(candidate: Candidate): boolean {
  if (candidate.origin !== "web-search") return true;
  if (candidate.evidenceStatus === "full" || candidate.evidenceStatus === "partial") return true;
  if (candidate.sourceTier !== "S") return false;
  const text = `${candidate.title} ${candidate.content}`;
  return FACT_MARKERS.test(text) && candidate.content.trim().length > candidate.title.trim().length + 20 && !isHypeTitle(candidate.title) && !isOpinionTitle(candidate.title);
}

function extractConcreteEventSubject(candidate: Candidate): string | null {
  const text = `${candidate.title} ${candidate.content}`.replace(/\s+/g, " ").trim();
  const extracted = extractEventEntity(candidate.title, candidate.content);
  if (extracted && !GENERIC_EVENT_SUBJECTS.test(extracted)) return extracted;
  const beforeAction = text.match(/(?:^|[：:，,。\s])([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9·-]{1,24}?)(?=(?:完成|推进|计划|重启|寻求|被曝|宣布|达成|签署|签约|获批|批准|启动|披露|拟))/);
  const subject = beforeAction?.[1]?.replace(/^(?:中国|国内|头部)/, "").trim();
  return subject && !GENERIC_EVENT_SUBJECTS.test(subject) ? subject : null;
}

function hasConcreteUnavailableEvent(candidate: Candidate): boolean {
  const text = `${candidate.title} ${candidate.content}`;
  const subject = extractConcreteEventSubject(candidate);
  if (!subject) return false;
  const hasAction = CONCRETE_EVENT_ACTIONS.test(text) && FACT_MARKERS.test(text);
  const hasDetails = CONCRETE_EVENT_DETAILS.test(text);
  return hasAction || hasDetails;
}

export function isClueQualityEligible(candidate: Candidate): boolean {
  if (candidate.origin !== "web-search" || candidate.evidenceStatus !== "unavailable") return true;
  return isWebEvidenceVerified(candidate) || hasConcreteUnavailableEvent(candidate) || isGenericWebCommentary(candidate);
}

function isGenericWebCommentary(candidate: Candidate): boolean {
  const text = `${candidate.title} ${candidate.content}`;
  return !hasConcreteUnavailableEvent(candidate) && (/趋势|热潮|热度|涌入|升温|持续|回顾|综述|盘点|行业|市场|资本/.test(text) || isOpinionTitle(candidate.title));
}

/** 单篇新闻不得单独成为趋势；至少 2 个独立主体事件指向同一变化。 */
export function partitionBriefItems(candidates: Candidate[]): {
  importantFacts: Candidate[];
  trendSignals: Candidate[];
  otherItems: Candidate[];
  editorialBackground: Candidate[];
} {
  const facts: Candidate[] = [];
  const others: Candidate[] = [];
  const editorialBackground: Candidate[] = [];
  for (const item of candidates) {
    if (!isClueQualityEligible(item)) continue;
    if (item.origin === "web-search" && item.evidenceStatus === "unavailable" && isGenericWebCommentary(item)) {
      editorialBackground.push({ ...item, kind: "other", isClue: false, followUpReason: undefined, importance: "low" });
      continue;
    }
    if (!isWebEvidenceVerified(item) || item.isClue || item.importance === "low" || item.kind === "other" || isHypeTitle(item.title) || isOpinionTitle(item.title)) {
      others.push({ ...item, kind: item.kind === "trend" ? "other" : item.kind, isClue: item.isClue || (!isWebEvidenceVerified(item) && hasConcreteUnavailableEvent(item)) || isHypeTitle(item.title) || isOpinionTitle(item.title) });
    } else {
      facts.push(item);
    }
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
    if (theme.length < 3) continue;
    // 独立事件：不同主体；转载/同主体不算两个
    const byEntity = new Map<string, Candidate>();
    for (const item of group) {
      const entity =
        extractEventEntity(String(item.subject || ""), "")
        || extractEventEntity(item.title, item.summary ?? item.content)
        || `title:${compactTitle(item.title).slice(0, 16)}`;
      const previous = byEntity.get(entity);
      if (!previous) byEntity.set(entity, item);
      else if ((item.sourceUrls?.length ?? 0) > (previous.sourceUrls?.length ?? 0)) byEntity.set(entity, item);
    }
    const independent = [...byEntity.values()];
    if (independent.length < 2) continue;

    const urls = [...new Set(independent.flatMap((item) => (item.sourceUrls?.length ? item.sourceUrls : item.sourceUrl ? [item.sourceUrl] : [])))];
    const domains = new Set(independent.map((item) => item.domain || item.source).filter(Boolean));
    if (domains.size < 2 && urls.length < 2) continue;

    const titles = independent.slice(0, 3).map((item) => item.title).join("；");
    const trend: Candidate = {
      id: `trend:${theme}:${independent[0]!.id}`,
      title: trendTitleFor(theme, independent),
      content: `本期至少有 ${independent.length} 条独立动态共同指向相关变化：${titles}。`,
      summary: `本期至少有 ${independent.length} 条独立动态共同指向相关变化：${titles}。`,
      source: independent.map((item) => item.source).join("; "),
      sourceUrl: independent[0]!.sourceUrl,
      sourceUrls: urls,
      publishedAt: independent.find((item) => !item.timeUnconfirmed)?.publishedAt || independent[0]!.publishedAt,
      timeUnconfirmed: independent.every((item) => item.timeUnconfirmed),
      subject: theme,
      region: null,
      kind: "trend",
      importance: "medium",
      relevance: "high",
      confidence: urls.length > 1 ? "high" : "medium",
      origin: independent[0]!.origin,
      investmentNote: buildInvestmentNote({ title: trendTitleFor(theme, independent), content: titles, summary: titles }) || undefined,
    };
    trendSignals.push(trend);
    // 趋势不吞掉原始事实卡：独立事件仍保留在重点/其他中供核对
    void used;
  }

  const importantFacts = facts.filter((item) => item.importance !== "low");
  const leftover = facts.filter((item) => item.importance === "low");
  return {
    importantFacts,
    trendSignals,
    otherItems: [...others, ...leftover],
    editorialBackground,
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

export function buildEditorialOverview(candidates: Candidate[], input: IntelligenceTaskInput, editorialBackground: Candidate[] = []): string {
  if (!candidates.length) return "本期未发现符合条件、且可核验的新增事实。";
  const top = candidates
    .filter((item) => item.kind === "fact" && !item.isClue && !isHypeTitle(item.title) && !isOpinionTitle(item.title))
    .slice(0, 3);
  const names = top.map((item) => sanitizeFactTitle(item.title, item.summary ?? item.content)).filter((name) => !isHypeTitle(name));
  const themes = [...new Set(top.map((item) => eventThemeKey(item.title, item.summary ?? item.content)))];
  const topic = [...input.topics, ...input.entities].filter(Boolean).slice(0, 2).join("、") || input.name;
  const parts: string[] = [];
  if (names.length >= 2) {
    parts.push(`本期「${topic}」仍有可跟踪进展，优先关注 ${names.slice(0, 2).join("，")}。`);
  } else if (names.length === 1) {
    parts.push(`本期「${topic}」较明确的新增事实是：${names[0]}。`);
  } else {
    const clues = candidates.filter((item) => item.isClue).slice(0, 2).map((item) => sanitizeFactTitle(item.title, item.summary ?? item.content));
    parts.push(`本期「${topic}」未发现证据充分、可确认的新重大事件。`);
    if (clues.length) {
      parts.push(`值得继续核实：${clues.join("；")}。`);
      const clue = candidates.find((item) => item.isClue)!;
      const hasCapitalBackground = editorialBackground.some((item) => /资本|融资|投资|估值|并购|收购|IPO|上市/.test(`${item.title} ${item.content}`));
      const commentary = hasCapitalBackground && /融资|募资|估值/.test(`${clue.title} ${clue.content}`)
        ? "若相关融资消息后续得到确认，相关企业持续高强度融资的资本特征值得关注；仍需核对金额、轮次和投资方。"
        : buildEditorialCommentary({ ...clue, isClue: true });
      if (commentary) parts.push(`简评：${commentary}`);
    }
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

function buildFollowUpReason(candidate: Candidate): string {
  const text = `${candidate.title} ${candidate.content}`;
  if (/融资|估值|金额|募资|上市|IPO|并购|收购|投资/.test(text)) return "涉及融资、估值或交易金额，需核对原始公告与交易细节";
  if (/政策|监管|许可|补贴|发改|工信|航天局|卫星互联网|条例|规划/.test(text)) return "可能涉及政策或监管变化，需核对发布主体与落地文件";
  if ((candidate.sourceUrls?.length ?? 0) > 1) return "多个来源正在跟进，但仍需找到原始公告或当事方确认";
  if (/商业航天|产业|论坛|推进会|火箭|卫星/.test(text)) return "涉及商业航天产业活动，需核对会议或发布主体及具体项目、融资是否落地";
  if (/公司|项目|产品|管线|火箭|卫星|模型|平台|药/.test(text)) return "涉及具体公司或项目进展，需补充原始来源确认事实";
  return "标题指向具体事件，但当前证据不足，需补充原始来源";
}

export function enrichCandidate(
  candidate: Candidate,
  input: IntelligenceTaskInput,
): Candidate {
  const sourceCount = Math.max(1, candidate.sourceUrls?.length ?? (candidate.sourceUrl ? 1 : 1));
  const entity = extractEventEntity(candidate.title, candidate.content);
  const title = sanitizeFactTitle(candidate.title, candidate.content);
  const cleanedEntity = extractEventEntity(title, candidate.content);
  // 清洗后仍含炒作词/评论词 → 线索；原文炒作且清洗后无主体 → 线索
  const genericCommentary = candidate.origin === "web-search" && candidate.evidenceStatus === "unavailable" && isGenericWebCommentary(candidate);
  const forceClue =
    isHypeTitle(title)
    || isOpinionTitle(title)
    || (isHypeTitle(candidate.title) && !cleanedEntity)
    || (sourceQualityRank(candidate.sourceTier) <= 1 && sourceCount <= 1)
    || (!isWebEvidenceVerified(candidate) && !genericCommentary);
  const summaryResult = buildFactSummary(title, candidate.content, {
    sourceCount,
    forceClue,
    trustedSource: sourceQualityRank(candidate.sourceTier) >= 2,
    preserveSummaryWhenSanitized: candidate.title !== title,
  });
  const isClue = genericCommentary ? false : summaryResult.isClue;
  const summary = summaryResult.summary;
  const investmentNote = genericCommentary
    ? undefined
    : isClue
      ? buildEditorialCommentary({ title, content: candidate.content, summary, isClue }, input)
      : summary
        ? buildEditorialCommentary({ title, content: candidate.content, summary, isClue }, input)
        : undefined;
  const confidence: Candidate["confidence"] =
    sourceCount > 1 || sourceQualityRank(candidate.sourceTier) >= 3
      ? "high"
      : isClue || candidate.timeUnconfirmed
        ? "low"
        : sourceQualityRank(candidate.sourceTier) >= 2
          ? "medium"
          : "low";
  return {
    ...candidate,
    title,
    summary,
    content: summary,
    subject: entity || candidate.subject,
    investmentNote: investmentNote || undefined,
    isClue,
    followUpReason: isClue ? buildFollowUpReason({ ...candidate, title, content: summary }) : undefined,
    kind: isClue || genericCommentary ? "other" : "fact",
    importance: genericCommentary ? "low" : candidate.importance,
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
      : concrete && (sourceQualityRank(candidate.sourceTier) >= 3 || (candidate.sourceUrls?.length ?? 0) > 1)
        ? "high"
        : concrete
          ? "medium"
          : "low";
    const confidence: Candidate["confidence"] =
      sourceQualityRank(candidate.sourceTier) >= 3 || (candidate.sourceUrls?.length ?? 0) > 1
        ? "high"
        : candidate.timeUnconfirmed || candidate.isClue
          ? "low"
          : sourceQualityRank(candidate.sourceTier) >= 2
            ? "medium"
            : "low";
    const kind: Candidate["kind"] = candidate.isClue ? "other" : candidate.kind === "trend" ? "trend" : "fact";
    return { ...candidate, relevance, importance, confidence, kind };
  }).sort((a, b) => {
    const rank = (value?: "high" | "medium" | "low") => (value === "high" ? 3 : value === "medium" ? 2 : 1);
    const tier = (value?: "S" | "A" | "B" | "C" | "D") => sourceQualityRank(value);
    const evidence = (item: Candidate) => item.evidenceStatus === "full" ? 3 : item.evidenceStatus === "partial" ? 2 : 1;
    const multi = (item: Candidate) => (item.sourceUrls?.length ?? (item.sourceUrl ? 1 : 0));
    const fresh = (item: Candidate) => (item.timeUnconfirmed ? 0 : Date.parse(item.publishedAt) || 0);
    return (
      tier(b.sourceTier) - tier(a.sourceTier)
      || evidence(b) - evidence(a)
      || rank(b.importance) - rank(a.importance)
      || rank(b.relevance) - rank(a.relevance)
      || multi(b) - multi(a)
      || fresh(b) - fresh(a)
    );
  });
}
