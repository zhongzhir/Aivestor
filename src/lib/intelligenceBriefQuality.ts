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
  evidencePublishedAt?: string | null;
  sourcePublishedAt?: string | null;
  url?: string | null;
  collectedAt?: string | null;
  generatedAt?: string | null;
}): {
  publishedAt: string | null;
  timeUnconfirmed: boolean;
  publishedAtSource: "evidence" | "provider" | "url" | "unknown";
  publishedAtConfidence: "high" | "medium" | "low" | "unknown";
} {
  const fromEvidence = parseLooseDate(options.evidencePublishedAt);
  if (fromEvidence) return { publishedAt: fromEvidence, timeUnconfirmed: false, publishedAtSource: "evidence", publishedAtConfidence: "high" };
  const fromSource = parseLooseDate(options.sourcePublishedAt);
  if (fromSource) return { publishedAt: fromSource, timeUnconfirmed: false, publishedAtSource: "provider", publishedAtConfidence: "medium" };
  const fromUrl = options.url ? normalizePublicTimestamp(dateFromUrl(options.url)) : null;
  if (fromUrl) return { publishedAt: fromUrl, timeUnconfirmed: false, publishedAtSource: "url", publishedAtConfidence: "low" };
  // 明确忽略 collectedAt / generatedAt
  void options.collectedAt;
  void options.generatedAt;
  return { publishedAt: null, timeUnconfirmed: true, publishedAtSource: "unknown", publishedAtConfidence: "unknown" };
}

export interface EvidenceBackedEventTime {
  eventDate: string | null;
  eventTimeText: string | null;
  support: "exact" | "vague" | "none";
}

export interface EventTimeEvidenceContext {
  /** 由事件标题/陈述确定的主主体；entities 数组本身没有排序契约。 */
  primarySubject?: string | null;
  subjects?: string[];
  eventText?: string;
  eventType?: string;
  /** All user-visible claim text whose concrete attributes must be sourced. */
  attributeText?: string;
}

const EVENT_DATE_ACTION = /完成|宣布|披露|签署|签约|达成|获批|批准|启动|提交|发生|交割|投资|入股|收购|并购|融资|募资|增资|发行|上市|纳入|生效|变更|任命|离职|completed?|announc(?:e|ed)|clos(?:e|ed)|sign(?:ed)?|acquir(?:e|ed)|invest(?:ed|ment)|financ(?:e|ing)|fundrais(?:e|ing)|merg(?:e|er)|filed?|approved?|effective|appointed?|resigned?/i;

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function eventDatePatterns(value: string): RegExp[] {
  const normalized = normalizePublicTimestamp(value);
  if (!normalized) return [];
  const [year, month, day] = normalized.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return [];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return [
    new RegExp(`(?:^|[^0-9])${year}\\s*[-/.]\\s*0?${month}\\s*[-/.]\\s*0?${day}(?:[^0-9]|$)`, "i"),
    new RegExp(`${year}\\s*年\\s*0?${month}\\s*月\\s*0?${day}\\s*日?`, "i"),
    new RegExp(`(?:${months[month - 1]}|${shortMonths[month - 1]})\\.?\\s+${day}(?:st|nd|rd|th)?[,]?\\s+${year}`, "i"),
    new RegExp(`${day}(?:st|nd|rd|th)?\\s+(?:${months[month - 1]}|${shortMonths[month - 1]})[,]?\\s+${year}`, "i"),
  ];
}

function evidenceSegments(texts: Array<string | null | undefined>): string[] {
  return texts
    .flatMap((text) => String(text || "").split(/[。！？；\n]+/u))
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function compactEvidenceText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function eventTerms(context: EventTimeEvidenceContext): string[] {
  const value = `${context.eventType || ""} ${context.eventText || ""}`;
  const matches = value.match(/融资|募资|增资|投资|入股|收购|并购|上市|发行|签约|签署|获批|批准|任命|离职|变更|纳入|生效|交割|fundrais(?:e|ing)|financ(?:e|ing)|invest(?:ed|ment)|acquir(?:e|ed)|merg(?:e|er)|appoint(?:ed|ment)|resign(?:ed|ation)|effective/gi) || [];
  return [...new Set(matches.map((item) => compactEvidenceText(item)))];
}

function roundOccurrences(value: string): Array<{ value: string; index: number }> {
  return [...value.matchAll(/(?:pre[-\s]?)?[a-f](?:\+|\d)?\s*轮|series\s+(?:pre[-\s]?)?[a-f](?:\+|\d)?/gi)].map((match) => ({
    value: match[0]!.replace(/series|\s+|轮/gi, "").toUpperCase(),
    index: match.index || 0,
  }));
}

function amountOccurrences(value: string): Array<{ value: string; index: number; length: number }> {
  const normalizedMillions = (rawNumber: string, multiplier: number) => {
    const numeric = Number(rawNumber.replace(/,/g, "")) * multiplier;
    if (!Number.isFinite(numeric)) return "invalid";
    return numeric.toFixed(6).replace(/\.?0+$/, "");
  };
  const chinesePattern = /(?:(人民币|RMB|CNY|美元|美金|港元|港币)\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(亿美元|亿元|万美元|万港元|亿港元|亿|千万|百万|万元|万)/gi;
  const chinese = [...value.matchAll(chinesePattern)].map((match) => {
    const prefix = (match[1] || "").toUpperCase();
    const unit = match[3]!;
    const currency = /美元|美金/.test(`${prefix}${unit}`) ? "USD"
      : /港元|港币/.test(`${prefix}${unit}`) ? "HKD" : "CNY";
    const multiplier = /亿/.test(unit) ? 100 : /千万/.test(unit) ? 10 : /百万/.test(unit) ? 1 : 0.01;
    return {
      value: `${currency}:${normalizedMillions(match[2]!, multiplier)}M`,
      index: match.index || 0,
      length: match[0]!.length,
    };
  });
  const englishPattern = /(?:USD|US\$|RMB|CNY|HKD|HK\$|EUR|GBP|\$|¥|€|£)\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:billion|bn|million|m|thousand|k)?|\d+(?:,\d{3})*(?:\.\d+)?\s*(?:billion|bn|million|m|thousand|k)?\s*(?:USD|RMB|CNY|HKD|EUR|GBP)/gi;
  const english = [...value.matchAll(englishPattern)].map((match) => {
    const raw = match[0]!;
    const lower = raw.toLowerCase().replace(/,/g, "");
    const currency = /rmb|cny|¥/.test(lower) ? "CNY"
      : /hkd|hk\$/.test(lower) ? "HKD"
        : /eur|€/.test(lower) ? "EUR"
          : /gbp|£/.test(lower) ? "GBP" : "USD";
    const number = lower.match(/\d+(?:\.\d+)?/)?.[0] || "";
    const suffix = lower.match(/\d+(?:\.\d+)?\s*(billion|bn|million|m|thousand|k)\b/)?.[1] || "";
    const magnitude = suffix === "bn" || suffix === "billion" ? "B"
      : suffix === "m" || suffix === "million" ? "M"
        : suffix === "k" || suffix === "thousand" ? "K" : "";
    const multiplier = magnitude === "B" ? 1_000 : magnitude === "M" ? 1 : magnitude === "K" ? 0.001 : 0.000001;
    return {
      value: `${currency}:${normalizedMillions(number, multiplier)}M`,
      index: match.index || 0,
      length: match[0]!.length,
    };
  });
  return [...chinese, ...english].sort((left, right) => left.index - right.index);
}

type AmountQualifier = "exact" | "approximate" | "lower-bound" | "upper-bound";

/**
 * The numeric amount alone is not the whole claim. “近 10 亿元” must not
 * support a model-authored exact “10 亿元”, and “超过/不超过” must keep their
 * direction. Currency/unit aliases remain normalized by amountOccurrences.
 */
function amountQualifier(value: string, index: number): AmountQualifier {
  const prefix = value.slice(Math.max(0, index - 24), index).trimEnd();
  if (/(?:不超过|不高于|至多|最多|低于|少于|不到|at\s+most|up\s+to|less\s+than|under)\s*$/i.test(prefix)) return "upper-bound";
  if (/(?:超过|高于|多于|逾|至少|不低于|more\s+than|over|at\s+least)\s*$/i.test(prefix)) return "lower-bound";
  if (/(?:大约|约为|约|近乎|接近|近|approximately|approx\.?|about|around|nearly|almost)\s*$/i.test(prefix)) return "approximate";
  return "exact";
}

function amountAttributeValues(value: string): string[] {
  return amountOccurrences(value).map((item) => `${item.value}:${amountQualifier(value, item.index)}`);
}

type EventActionFamily = "financing" | "mna" | "investment" | "listing" | "agreement" | "approval" | "personnel" | "change";
type EventActionPhase = "planned" | "announced" | "completed";

const EVENT_ACTION_FAMILIES: Array<{ family: EventActionFamily; pattern: RegExp }> = [
  { family: "financing", pattern: /融资|募资|增资|fundrais(?:e|ing)|financ(?:e|ing)/gi },
  { family: "mna", pattern: /收购(?!方)|并购|交割|acquir(?:e|ed)|merg(?:e|er)|clos(?:e|ed)/gi },
  { family: "investment", pattern: /投资(?!方|者|机构|人)|入股|invest(?:ed|ment)/gi },
  { family: "listing", pattern: /上市|IPO|发行|list(?:ed|ing)|issu(?:e|ed|ance)/gi },
  { family: "agreement", pattern: /签署|签约|达成|sign(?:ed|ing)|agreement/gi },
  { family: "approval", pattern: /获批|批准|approv(?:e|ed|al)/gi },
  { family: "personnel", pattern: /任命|离职|appoint(?:ed|ment)|resign(?:ed|ation)/gi },
  { family: "change", pattern: /变更|纳入|生效|chang(?:e|ed)|effective/gi },
];

function actionPhaseBefore(value: string, index: number): EventActionPhase | null {
  const prefix = value.slice(Math.max(0, index - 32), index);
  const markers = [...prefix.matchAll(/计划|拟|寻求|预计|将要|将于|plan(?:ned|s|ning)?|intend(?:ed|s)?|seek(?:s|ing)?|宣布|披露|公告|announc(?:e|ed)|disclos(?:e|ed)|完成|交割|落地|生效|获批|批准|complet(?:e|ed)|clos(?:e|ed)|effective|approv(?:e|ed)/gi)];
  const marker = markers.at(-1)?.[0] || "";
  if (/计划|拟|寻求|预计|将要|将于|plan|intend|seek/i.test(marker)) return "planned";
  if (/宣布|披露|公告|announc|disclos/i.test(marker)) return "announced";
  if (/完成|交割|落地|生效|获批|批准|complet|clos|effective|approv/i.test(marker)) return "completed";
  return null;
}

function eventActionOccurrences(value: string): Array<{ family: EventActionFamily; phase: EventActionPhase | null; index: number; length: number }> {
  return EVENT_ACTION_FAMILIES.flatMap(({ family, pattern }) => [...value.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => ({
    family,
    phase: actionPhaseBefore(value, match.index || 0),
    index: match.index || 0,
    length: match[0].length,
  }))).sort((a, b) => a.index - b.index);
}

function targetEventAction(context: EventTimeEvidenceContext): { family: EventActionFamily; phase: EventActionPhase | null } | null {
  const typed = eventActionOccurrences(context.eventType || "");
  const described = eventActionOccurrences(context.eventText || "");
  const describedFamilies = [...new Set(described.map((action) => action.family))];
  const typedFamilies = [...new Set(typed.map((action) => action.family))];
  // eventType 可能是“上市流动性”等业务分类；事件陈述中唯一明确动作更接近事实语义。
  const families = describedFamilies.length === 1 ? describedFamilies : typedFamilies;
  if (families.length !== 1) return null;
  const describedForFamily = described.filter((action) => action.family === families[0]);
  const phases = [...new Set(describedForFamily.map((action) => action.phase).filter(Boolean))];
  const phase = describedForFamily.length === 1
    ? describedForFamily[0]!.phase
    : describedForFamily.length > 1 && describedForFamily.every((action) => !!action.phase) && phases.length === 1
      ? phases[0]!
      : null;
  return { family: families[0]!, phase };
}

function temporalRangeAt(value: string, point: number): { start: number; end: number } {
  const local = value.slice(Math.max(0, point), Math.min(value.length, point + 48));
  const match = local.match(/20\d{2}\s*年\s*(?:\d{1,2}\s*月(?:\s*\d{1,2}\s*日?|(?:上旬|中旬|下旬|前|后|期间)?)|春节(?:前|后|期间)?|元旦(?:前|后|期间)?|国庆(?:前|后|期间)?|上半年|下半年|第?[一二三四1-4]季度|初|中|末|底)|20\d{2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[,]?\s+20\d{2}/i);
  const start = Math.max(0, point) + (match?.index || 0);
  return { start, end: match ? start + match[0].length : start };
}

function actionDistance(action: { index: number; length: number }, time: { start: number; end: number }): number {
  const actionEnd = action.index + action.length;
  if (actionEnd <= time.start) return time.start - actionEnd;
  if (action.index >= time.end) return action.index - time.end;
  return 0;
}

/**
 * 一个语义范围含多个事件动作时，日期只归属于距离最近且唯一的动作族。
 * 若同一动作族还包含多个计划/宣布/完成阶段且目标阶段不明确，则安全降级。
 */
function eventActionBindingMatches(segment: string, point: number, context: EventTimeEvidenceContext): boolean {
  const target = targetEventAction(context);
  const actions = eventActionOccurrences(segment);
  if (!target) return new Set(actions.map((action) => action.family)).size <= 1;
  const relevant = actions.filter((action) => action.family === target.family);
  if (!relevant.length) return false;

  const families = new Set(actions.map((action) => action.family));
  const time = temporalRangeAt(segment, point);
  const distances = actions.map((action) => ({ action, distance: actionDistance(action, time) }));
  const minimum = Math.min(...distances.map((entry) => entry.distance));
  const nearest = distances.filter((entry) => entry.distance === minimum).map((entry) => entry.action);
  if (families.size > 1 && (new Set(nearest.map((action) => action.family)).size !== 1 || nearest[0]?.family !== target.family)) return false;

  const targetFamilyActions = actions.filter((action) => action.family === target.family);
  const familyPhases = new Set(targetFamilyActions.map((action) => action.phase).filter(Boolean));
  const exactDates = extractExplicitCalendarDates(segment);
  const nearestTargetDistance = Math.min(...targetFamilyActions.map((action) => actionDistance(action, time)));
  const nearestTarget = targetFamilyActions.filter((action) => actionDistance(action, time) === nearestTargetDistance);
  if (target.phase && nearestTarget.length === 1 && nearestTarget[0]!.phase && nearestTarget[0]!.phase !== target.phase) return false;
  if (targetFamilyActions.length > 1 && familyPhases.size > 1) {
    if (nearestTarget.length !== 1 || !target.phase || nearestTarget[0]!.phase !== target.phase) return false;
  } else if (exactDates.length > 1 && targetFamilyActions.length > 1 && !target.phase) {
    return false;
  }
  if (exactDates.length > 1 && actions.length === 1) return false;
  return true;
}

interface EventClause {
  text: string;
  point: number;
  start: number;
  end: number;
  index: number;
  clauses: Array<{ text: string; start: number; end: number }>;
}

function eventClauses(segment: string): Array<{ text: string; start: number; end: number }> {
  const entityThenAction = "(?:由)?[\\u4e00-\\u9fffA-Za-z0-9·-]{1,24}?(?:股份有限公司|有限责任公司|有限公司|公司|科技|集团|资本|基金)(?:于|在|宣布|披露|完成|收购|并购|投资|融资|募资|签署|签约|获批|启动)";
  const boundary = new RegExp(`[，,；;。！？]|(?:并|又|随后|之后|同时)(?=(?:于|在|${entityThenAction}))|\\b(?:and\\s+then|then)\\b`, "gi");
  const matches = [...segment.matchAll(boundary)];
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const match of matches) {
    const end = match.index || 0;
    if (end > start) clauses.push({ text: segment.slice(start, end), start, end });
    start = end + match[0].length;
  }
  if (start < segment.length) clauses.push({ text: segment.slice(start), start, end: segment.length });
  return clauses;
}

function eventClauseAt(segment: string, point: number): EventClause {
  const clauses = eventClauses(segment);
  let index = clauses.findIndex((clause) => point >= clause.start && point < clause.end);
  if (index < 0) index = Math.max(0, clauses.findIndex((clause) => point < clause.start) - 1);
  const clause = clauses[index] || { text: segment, start: 0, end: segment.length };
  return { ...clause, point: Math.max(0, point - clause.start), index, clauses };
}

function isStandaloneTemporalLead(value: string): boolean {
  if (/发布(?:时间|日期)?|报道(?:时间|日期|于)?|更新(?:时间|日期)?|文章来源|来源日期|published|updated/i.test(value)) return false;
  const withoutDates = extractExplicitCalendarDates(value)
    .reduce((result, date) => replaceUnsupportedEventDate(result, date, "__EVENT_DATE__"), value)
    .replace(/__EVENT_DATE__/g, "")
    .replace(/(?:^|\s)(?:on|as\s+of|dated)\b/gi, "")
    .replace(/于|在|截至|当日|当天|日期|时间|[\s:：()（）【】\[\]]/gu, "");
  return withoutDates.length === 0;
}

/**
 * 日期可放在紧邻事件从句之前（“2024-01-22，甲公司完成融资”）。只有当前从句
 * 是纯时间前缀且下一从句包含事件动作时才合并，避免把文章来源日期或更远事件借入。
 */
function eventSemanticScopeAt(segment: string, point: number): { text: string; point: number } {
  const current = eventClauseAt(segment, point);
  if (EVENT_DATE_ACTION.test(current.text)) return { text: current.text, point: current.point };
  const next = current.clauses[current.index + 1];
  if (!next || !isStandaloneTemporalLead(current.text) || !EVENT_DATE_ACTION.test(next.text)) {
    return { text: current.text, point: current.point };
  }
  return {
    text: segment.slice(current.start, next.end),
    point: point - current.start,
  };
}

function eventDiscriminatorsMatch(segment: string, point: number, context: EventTimeEvidenceContext): boolean {
  const targetRounds = new Set(roundOccurrences(`${context.eventType || ""} ${context.eventText || ""}`).map((item) => item.value));
  const sourceRounds = roundOccurrences(segment);
  if (targetRounds.size) {
    if (!sourceRounds.length) return false;
    const minimum = Math.min(...sourceRounds.map((item) => Math.abs(item.index - point)));
    const nearest = sourceRounds.filter((item) => Math.abs(item.index - point) === minimum);
    if (nearest.length !== 1 || !targetRounds.has(nearest[0]!.value)) return false;
  } else if (sourceRounds.length > 1) {
    return false;
  }

  const targetAmounts = new Set(amountOccurrences(context.eventText || "").map((item) => item.value));
  const sourceAmounts = amountOccurrences(segment);
  if (targetAmounts.size && sourceAmounts.length) {
    const minimum = Math.min(...sourceAmounts.map((item) => Math.abs(item.index - point)));
    const nearest = sourceAmounts.filter((item) => Math.abs(item.index - point) === minimum);
    if (nearest.length !== 1 || !targetAmounts.has(nearest[0]!.value)) return false;
  }
  if (!eventActionBindingMatches(segment, point, context)) return false;
  if (!targetRounds.size && !targetAmounts.size && extractExplicitCalendarDates(segment).length > 1 && !targetEventAction(context)) return false;
  return true;
}

function occurrenceDistances(text: string, needle: string, point: number): number[] {
  const result: number[] = [];
  let offset = 0;
  while (needle && offset < text.length) {
    const index = text.indexOf(needle, offset);
    if (index < 0) break;
    result.push(Math.abs(index - point));
    offset = index + Math.max(1, needle.length);
  }
  return result;
}

function normalizeNamedEntity(value: string): string {
  let normalized = compactEvidenceText(value)
    .replace(/^(?:于|在)?20\d{2}(?:年\d{1,2}月\d{1,2}日?|[-/.]\d{1,2}[-/.]\d{1,2})/u, "")
    .replace(/^(?:完成|宣布|披露|计划|拟|再次|正在|推进|成功|收购|并购|投资|入股|获得|达成|签署|购买|出售)/u, "")
    .replace(/^(?:与|和|对|向|被|由|买方|卖方|投资方|领投方|收购方|标的)/u, "");
  // “完成对乙公司”“宣布收购乙公司”等常见叙事可能含两层前缀；仅剥离角色/动作前缀，
  // 不改实体核心，避免以自然语言相似度替代事件身份。
  normalized = normalized
    .replace(/^(?:完成|宣布|披露|计划|拟|再次|正在|推进|成功|收购|并购|投资|入股|获得|达成|签署|购买|出售)/u, "")
    .replace(/^(?:与|和|对|向|被|由|买方|卖方|投资方|领投方|收购方|标的)/u, "");
  return normalized;
}

function namedEntities(value: string): string[] {
  const chinese = [...value.matchAll(/[\u4e00-\u9fffA-Za-z0-9·-]{1,24}?(?:股份有限公司|有限责任公司|有限公司|医药|制药|药业|生物|航天|火箭|卫星|股份|公司|科技(?!有限公司|有限责任公司)|集团|资本|基金)/gu)];
  const english = [...value.matchAll(/\b[A-Z][A-Za-z0-9&.'’-]*(?:\s+(?:[A-Z][A-Za-z0-9&.'’-]*|of|the)){0,5}\s+(?:Capital|Ventures|Partners|Funds?|Holdings|Group|Company|Corp(?:oration)?|Inc(?:orporated)?|Ltd|Limited|Technologies|Technology|Robotics)\b/g)];
  return [...chinese, ...english]
    .map((match) => normalizeNamedEntity(match[0]))
    .filter((entity) => entity.length >= 2);
}

function entityCore(value: string): string {
  return compactEvidenceText(value).replace(/(?:股份有限公司|有限责任公司|有限公司|医药|制药|药业|生物|航天|火箭|卫星|股份|公司|科技|集团|资本|基金|capital|ventures|partners|funds?|holdings|group|company|corporation|corp|incorporated|inc|limited|ltd|technologies|technology|robotics)$/u, "");
}

function sameEventEntity(left: string, right: string): boolean {
  const a = compactEvidenceText(left);
  const b = compactEvidenceText(right);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)))) return true;
  const coreA = entityCore(a);
  const coreB = entityCore(b);
  return coreA.length >= 2 && coreB.length >= 2 && coreA === coreB;
}

function isLikelyEventActor(scope: string, entityEnd: number): boolean {
  return /^(?:\s*(?:于|在)\s*(?:20\d{2}[^，,；;。！？]{0,20})?)?\s*(?:宣布|披露|完成|签署|签约|达成|获批|批准|启动|提交|发生|交割|收购|并购|投资|入股|融资|募资|增资|发行|上市|变更|任命|离职)/iu
    .test(scope.slice(entityEnd, entityEnd + 64));
}

function eventTimeBoundToSubject(segment: string, point: number, context: EventTimeEvidenceContext): boolean {
  const inferred = context.primarySubject || extractEventEntity(context.eventText || "");
  const entityCandidates = [...new Set((context.subjects ?? []).map(compactEvidenceText).filter((item) => item.length >= 2))];
  const primary = compactEvidenceText(inferred || (entityCandidates.length === 1 ? entityCandidates[0]! : ""));
  if (primary.length < 2) return false;
  const compactSegment = compactEvidenceText(segment);
  const compactPoint = compactEvidenceText(segment.slice(0, point)).length;
  const primaryDistance = Math.min(...occurrenceDistances(compactSegment, primary, compactPoint));
  if (!Number.isFinite(primaryDistance) || primaryDistance > 64) return false;

  const clause = eventSemanticScopeAt(segment, point);
  const compactClause = compactEvidenceText(clause.text);
  const compactClausePoint = compactEvidenceText(clause.text.slice(0, clause.point)).length;
  const terms = eventTerms(context);
  if (terms.length && !terms.some((term) => occurrenceDistances(compactClause, term, compactClausePoint).some((distance) => distance <= 64))) return false;
  if (!EVENT_DATE_ACTION.test(clause.text)) return false;
  if (!eventDiscriminatorsMatch(clause.text, clause.point, context)) return false;

  // 主体、投资方和交易对手可共同属于一个事件。仅当另一个未在目标事件陈述中出现的
  // 实体更靠近日期且像另一个事件的发起者时，才拒绝日期，避免把交易对手误当竞争事件。
  const contextText = compactEvidenceText(context.eventText || "");
  const participants = [primary, ...(context.subjects ?? []).map(compactEvidenceText), ...namedEntities(context.eventText || "")]
    .filter((entity) => entity.length >= 2 && (sameEventEntity(entity, primary) || contextText.includes(entity)));
  const entityPattern = /[\u4e00-\u9fffA-Za-z0-9·-]{1,24}?(?:股份有限公司|有限责任公司|有限公司|医药|制药|药业|生物|航天|火箭|卫星|股份|公司|科技(?!有限公司|有限责任公司)|集团|资本|基金)/gu;
  for (const match of clause.text.matchAll(entityPattern)) {
    const entity = compactEvidenceText(match[0]);
    if (!entity || participants.some((participant) => sameEventEntity(entity, participant))) continue;
    const entityPoint = compactEvidenceText(clause.text.slice(0, match.index || 0)).length;
    const entityEnd = (match.index || 0) + match[0].length;
    if (Math.abs(entityPoint - compactClausePoint) < primaryDistance && isLikelyEventActor(clause.text, entityEnd)) return false;
  }
  return true;
}

function vagueEventTimeFromSegments(segments: string[], context: EventTimeEvidenceContext): string | null {
  const chinese = /(20\d{2}\s*年\s*(?:(?:春节|元旦|国庆|上半年|下半年|第一季度|第二季度|第三季度|第四季度|一季度|二季度|三季度|四季度)(?:前|后|期间|以来)?|(?:初|中|末|底)(?:前|后|期间|以来)?|\d{1,2}\s*月(?!\s*\d{1,2}\s*日)(?:上旬|中旬|下旬|前|后|期间)?))/gu;
  const english = /\b((?:early|mid|late)\s+20\d{2}|(?:Q[1-4]|first|second|third|fourth quarter)\s+(?:of\s+)?20\d{2}|before\s+(?:the\s+)?(?:Spring Festival|Lunar New Year)\s+20\d{2})\b/gi;
  for (const segment of segments) {
    const matches = [...segment.matchAll(chinese), ...segment.matchAll(english)].sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const match of matches) {
      if (match[1] && eventTimeBoundToSubject(segment, match.index || 0, context)) return match[1].replace(/\s+/g, "").replace(/of(?=20\d{2})/i, " of ");
    }
  }
  return null;
}

/**
 * 事件日只能由正文中的“日期 + 事件动作”共同支持；文章来源日期、URL 日期和
 * 模型输出本身都不能单独证明事件发生日。精确日期无证据时保留正文中的模糊时间。
 */
export function resolveEvidenceBackedEventTime(
  eventDate: string | null | undefined,
  evidenceTexts: Array<string | null | undefined>,
  context: EventTimeEvidenceContext = {},
): EvidenceBackedEventTime {
  const segments = evidenceSegments(evidenceTexts);
  const normalized = eventDate ? normalizePublicTimestamp(eventDate) : null;
  if (normalized) {
    const patterns = eventDatePatterns(normalized);
    if (segments.some((segment) => patterns.some((pattern) => {
      const match = pattern.exec(segment);
      return !!match && eventTimeBoundToSubject(segment, match.index, context);
    }))) {
      return { eventDate: normalized.slice(0, 10), eventTimeText: null, support: "exact" };
    }
  }
  const eventTimeText = vagueEventTimeFromSegments(segments, context);
  return eventTimeText
    ? { eventDate: null, eventTimeText, support: "vague" }
    : { eventDate: null, eventTimeText: null, support: "none" };
}

/**
 * Reuse the same subject/action/round/amount scoping used by the event-date
 * gate for the claim itself. A citation is not support merely because it
 * contains the same date somewhere in the page.
 */
export function evidenceSupportsEventClaim(
  evidenceTexts: Array<string | null | undefined>,
  context: EventTimeEvidenceContext = {},
): boolean {
  const target = targetEventAction(context);
  if (!target) return false;
  const inferred = context.primarySubject || extractEventEntity(context.eventText || "");
  const primary = compactEvidenceText(inferred || "");
  if (primary.length < 2) return false;
  const targetRounds = new Set(roundOccurrences(`${context.eventType || ""} ${context.eventText || ""}`).map((item) => item.value));
  const targetAmounts = new Set(amountOccurrences(context.eventText || "").map((item) => item.value));
  for (const segment of evidenceSegments(evidenceTexts)) {
    const actions = eventActionOccurrences(segment).filter((action) => action.family === target.family);
    for (const action of actions) {
      if (target.phase && action.phase && target.phase !== action.phase) continue;
      const clause = eventClauseAt(segment, action.index).text;
      const compactClause = compactEvidenceText(clause);
      const subjectMatches = namedEntities(clause).some((entity) => sameEventEntity(entity, primary))
        || compactClause.includes(primary)
        || (entityCore(primary).length >= 2 && compactClause.includes(entityCore(primary)));
      if (!subjectMatches) continue;
      const sourceRounds = new Set(roundOccurrences(clause).map((item) => item.value));
      if (targetRounds.size && ![...targetRounds].some((round) => sourceRounds.has(round))) continue;
      const sourceAmounts = new Set(amountOccurrences(clause).map((item) => item.value));
      if (targetAmounts.size && sourceAmounts.size && ![...targetAmounts].some((amount) => sourceAmounts.has(amount))) continue;
      return true;
    }
  }
  return false;
}

export interface EvidenceBoundClaimValidation {
  subjectSupported: boolean;
  eventActionSupported: boolean;
  unsupportedAttributes: string[];
}

function sourceMentionsSubject(source: string, context: EventTimeEvidenceContext): boolean {
  const inferred = context.primarySubject || extractEventEntity(context.eventText || "");
  const primary = compactEvidenceText(inferred || "");
  if (primary.length < 2) return false;
  const compactSource = compactEvidenceText(source);
  return namedEntities(source).some((entity) => sameEventEntity(entity, primary))
    || compactSource.includes(primary)
    || (entityCore(primary).length >= 2 && compactSource.includes(entityCore(primary)));
}

function percentageValues(value: string): string[] {
  return [...value.matchAll(/\d+(?:\.\d+)?\s*%|百分之\s*[零〇一二两三四五六七八九十百千万\d.]+/gu)]
    .map((match) => compactEvidenceText(match[0]));
}

function numericClaimValues(value: string): string[] {
  // Amounts are compared in a currency + base-unit representation above. Mask
  // their raw digits here so equivalent expressions such as 1亿美元 and
  // $100 million are not rejected by the generic number gate.
  const masked = value.split("");
  for (const amount of amountOccurrences(value)) {
    for (let index = amount.index; index < amount.index + amount.length; index += 1) masked[index] = " ";
  }
  return [...masked.join("").matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)]
    .map((match) => match[0]!.replace(/,/g, "").replace(/^0+(?=\d)/, ""));
}

function roleFamilies(value: string): string[] {
  const families: Array<[string, RegExp]> = [
    ["lead-investor", /领投|牵头投资|lead(?:ing)?\s+(?:the\s+)?(?:round|financing|investment)|led\s+(?:the\s+)?(?:round|financing|investment)|led\s+by|(?:was|is|served\s+as)\s+(?:the\s+|a\s+)?lead\s+investor/i],
    ["participating-investor", /跟投|参投|联合投资|participat(?:e|ed|ing)\s+in\s+(?:the\s+)?(?:round|financing|investment)|participation\s+from|(?:was|is)\s+(?:an?\s+)?(?:participating\s+)?investor/i],
    ["buyer", /收购方|买方|acquirer|buyer/i],
    ["seller", /出售方|卖方|出让方|seller|divestor/i],
    ["target", /被收购方|标的方|target\s+(?:company|business)/i],
  ];
  return families.filter(([, pattern]) => pattern.test(value)).map(([family]) => family);
}

function roleSemanticSegments(value: string): string[] {
  return value
    .replace(/\r/g, "")
    .split(/\n+|[。！？!?；;]+|\.\s+(?=[A-Z])/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function segmentMentionsEntity(segment: string, entity: string): boolean {
  const compactSegment = compactEvidenceText(segment);
  const compactEntity = compactEvidenceText(entity);
  const core = entityCore(entity);
  return compactSegment.includes(compactEntity)
    || (core.length >= 2 && compactSegment.includes(core));
}

function roleEntityBindings(value: string, entities: string[]): Array<{ role: string; entity: string }> {
  const bindings: Array<{ role: string; entity: string }> = [];
  for (const segment of roleSemanticSegments(value)) {
    const roles = roleFamilies(segment);
    if (!roles.length) continue;
    for (const entity of entities) {
      if (!segmentMentionsEntity(segment, entity)) continue;
      for (const role of roles) bindings.push({ role, entity });
    }
  }
  return bindings.filter((binding, index, all) => all.findIndex((candidate) => (
    candidate.role === binding.role && sameEventEntity(candidate.entity, binding.entity)
  )) === index);
}

/**
 * Validate model-authored event attributes against the concrete cited sources.
 * The event classifier may be incomplete; unknown actions can still become a
 * clue, but amounts, rounds, percentages, named counterparties and transaction
 * roles never become facts unless a source supporting the same subject/event
 * also contains them.
 */
export function validateEvidenceBoundClaim(
  evidenceTexts: Array<string | null | undefined>,
  context: EventTimeEvidenceContext = {},
): EvidenceBoundClaimValidation {
  const sources = evidenceTexts.map((text) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const subjectSources = sources.filter((source) => sourceMentionsSubject(source, context));
  const eventSources = sources.filter((source) => evidenceSupportsEventClaim([source], context));
  const supportingSources = eventSources.length ? eventSources : subjectSources;
  const claimText = `${context.eventType || ""} ${context.attributeText || context.eventText || ""}`;
  const unsupported = new Set<string>();

  const requireExactAttribute = (label: string, values: string[], sourceValues: (source: string) => string[]) => {
    for (const value of [...new Set(values.filter(Boolean))]) {
      if (!supportingSources.some((source) => sourceValues(source).includes(value))) unsupported.add(`${label}:${value}`);
    }
  };
  requireExactAttribute("round", roundOccurrences(claimText).map((item) => item.value), (source) => roundOccurrences(source).map((item) => item.value));
  requireExactAttribute("amount", amountAttributeValues(claimText), amountAttributeValues);
  requireExactAttribute("percentage", percentageValues(claimText), percentageValues);
  requireExactAttribute("number", numericClaimValues(claimText), numericClaimValues);

  const primary = compactEvidenceText(context.primarySubject || extractEventEntity(context.eventText || "") || "");
  const claimEntities = [...new Set([
    ...(context.subjects || []),
    ...namedEntities(context.eventText || ""),
  ].map(compactEvidenceText).filter((entity) => entity.length >= 2 && !sameEventEntity(entity, primary)))];
  for (const entity of claimEntities) {
    const supported = supportingSources.some((source) => {
      const compactSource = compactEvidenceText(source);
      return namedEntities(source).some((candidate) => sameEventEntity(candidate, entity))
        || compactSource.includes(entity)
        || (entityCore(entity).length >= 2 && compactSource.includes(entityCore(entity)));
    });
    if (!supported) unsupported.add(`entity:${entity}`);
  }

  const claimRoles = roleFamilies(claimText);
  const claimRoleBindings = roleEntityBindings(claimText, claimEntities);
  for (const binding of claimRoleBindings) {
    const supported = supportingSources.some((source) => roleSemanticSegments(source).some((segment) => (
      roleFamilies(segment).includes(binding.role) && segmentMentionsEntity(segment, binding.entity)
    )));
    if (!supported) unsupported.add(`role:${binding.role}:${binding.entity}`);
  }
  const boundRoles = new Set(claimRoleBindings.map((binding) => binding.role));
  for (const role of claimRoles.filter((candidate) => !boundRoles.has(candidate))) {
    if (!supportingSources.some((source) => roleFamilies(source).includes(role))) unsupported.add(`role:${role}`);
  }

  return {
    subjectSupported: subjectSources.length > 0,
    eventActionSupported: eventSources.length > 0,
    unsupportedAttributes: [...unsupported],
  };
}

/** 只替换已判定无证据的那一个精确日期，不改动其它事件日期。 */
export function replaceUnsupportedEventDate(text: string, eventDate: string | null | undefined, fallback?: string | null): string {
  const normalized = eventDate ? normalizePublicTimestamp(eventDate) : null;
  if (!normalized || !text) return text;
  const [year, month, day] = normalized.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return text;
  const replacement = fallback || "事件日期未确认";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const replacements: Array<[RegExp, string]> = [
    [new RegExp(`(^|[^0-9])${year}\\s*[-/.]\\s*0?${month}\\s*[-/.]\\s*0?${day}(?:T\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?=$|[^0-9])`, "gi"), `$1${replacement}`],
    [new RegExp(`${year}\\s*年\\s*0?${month}\\s*月\\s*0?${day}\\s*日?`, "gi"), replacement],
    [new RegExp(`(?:${regexEscape(months[month - 1]!)}|${regexEscape(shortMonths[month - 1]!)})\\.?\\s+${day}(?:st|nd|rd|th)?[,]?\\s+${year}`, "gi"), replacement],
    [new RegExp(`${day}(?:st|nd|rd|th)?\\s+(?:${regexEscape(months[month - 1]!)}|${regexEscape(shortMonths[month - 1]!)})[,]?\\s+${year}`, "gi"), replacement],
  ];
  const replaced = replacements.reduce((result, [pattern, value]) => result.replace(pattern, value), text);
  // A guessed precise date is often followed by a relational suffix ("日前",
  // "之前", "around"). When the replacement already carries the supported
  // vague relation, or when no relation is supportable, retaining that suffix
  // creates nonsense such as "2024年春节前前" or "事件日期未确认前".
  return replaced
    .replace(new RegExp(`${regexEscape(replacement)}\\s*(?:日前后|前后|以前|以后|之前|之后|日前|左右|期间|前|后)`, "gu"), replacement)
    .replace(new RegExp(`(?:before|after|around)\\s+${regexEscape(replacement)}`, "giu"), replacement);
}

/** 提取用户可见文本中的精确日，用于对 answer/summary 等二次输出做统一门禁。 */
export function extractExplicitCalendarDates(text: string | null | undefined): string[] {
  if (!text) return [];
  const dates: string[] = [];
  const add = (year: number, month: number, day: number) => {
    const value = ymdToIso(year, month, day)?.slice(0, 10);
    if (value && !dates.includes(value)) dates.push(value);
  };
  for (const match of text.matchAll(/(?:^|[^0-9])(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?=$|[^0-9])/g)) add(Number(match[1]), Number(match[2]), Number(match[3]));
  for (const match of text.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g)) add(Number(match[1]), Number(match[2]), Number(match[3]));
  const monthLookup = new Map([
    ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4], ["may", 5], ["june", 6], ["jun", 6],
    ["july", 7], ["jul", 7], ["august", 8], ["aug", 8], ["september", 9], ["sep", 9], ["october", 10], ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12],
  ] as Array<[string, number]>);
  for (const match of text.matchAll(/\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi)) add(Number(match[3]), monthLookup.get(match[1]!.toLocaleLowerCase()) || 0, Number(match[2]));
  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|October|Oct|November|Nov|December|Dec)[,]?\s+(20\d{2})\b/gi)) add(Number(match[3]), monthLookup.get(match[2]!.toLocaleLowerCase()) || 0, Number(match[1]));
  return dates;
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
  const company = text.match(/([\u4e00-\u9fffA-Za-z0-9·\-]{1,20}?(?:医药|制药|药业|生物|科技|航天|火箭|卫星|股份|公司))/);
  if (company?.[1]) return company[1].replace(/\s+/g, "").toLocaleLowerCase();
  const asset = text.match(/([A-Z]{1,5}[-\s]?\d{3,5}|TY[‑\-]?\d{3,5})/i);
  // Currency + amount expressions (for example USD 100m) match the generic
  // asset-code shape but are attributes, never the event subject.
  if (asset?.[1] && !/^(?:USD|RMB|CNY|HKD|EUR|GBP)[-\s]?\d/i.test(asset[1])) {
    return asset[1].replace(/\s+/g, "").toLocaleLowerCase();
  }
  const beforeAmount = text.match(/([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9·\-]{1,20}?)(?=\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币))/);
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

function eventIdentityDate(candidate: Candidate): string | null {
  const normalized = candidate.eventDate ? normalizePublicTimestamp(candidate.eventDate) : null;
  return normalized ? normalized.slice(0, 10) : null;
}

function eventCounterparts(candidate: Candidate, actor: string): string[] {
  const theme = eventThemeKey(candidate.title, candidate.content);
  if (theme !== "mna" && theme !== "bd-licensing" && !/投资(?!方|者|机构|人)|入股/.test(`${candidate.title} ${candidate.content}`)) return [];
  return [...new Set(namedEntities(`${candidate.title} ${candidate.content}`)
    .filter((entity) => !sameEventEntity(entity, actor)))]
    .sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function eventAmountKey(candidate: Candidate): string[] {
  return [...`${candidate.title} ${candidate.content}`.matchAll(/\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币)/g)]
    .map((match) => match[0]!.replace(/\s+/g, ""))
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort();
}

function sameUnderlyingEvent(a: Candidate, b: Candidate): boolean {
  const entityA = extractEventEntity(a.title, a.content);
  const entityB = extractEventEntity(b.title, b.content);
  const themeA = eventThemeKey(a.title, a.content);
  const themeB = eventThemeKey(b.title, b.content);
  if (!entityA || !entityB || !sameEventEntity(entityA, entityB) || themeA !== themeB) return false;

  // 发布时间是报道属性，不能充当事件身份；事件日本身缺失时默认不合并。
  const dateA = eventIdentityDate(a);
  const dateB = eventIdentityDate(b);
  if (!dateA || !dateB || dateA !== dateB) return false;
  if (Math.max(evidenceRank(a), evidenceRank(b)) === 0) return false;

  if (themeA === "mna" || themeA === "bd-licensing" || /投资(?!方|者|机构|人)|入股/.test(`${a.title} ${a.content} ${b.title} ${b.content}`)) {
    const counterpartA = eventCounterparts(a, entityA);
    const counterpartB = eventCounterparts(b, entityB);
    return counterpartA.length > 0 && counterpartB.length > 0 && sameStringSet(counterpartA, counterpartB);
  }

  if (themeA === "financing") {
    const roundsA = financingRounds(`${a.title} ${a.content}`);
    const roundsB = financingRounds(`${b.title} ${b.content}`);
    if (roundsA.length || roundsB.length) return roundsA.length > 0 && roundsB.length > 0 && sameStringSet(roundsA, roundsB);
    const amountsA = eventAmountKey(a);
    const amountsB = eventAmountKey(b);
    return amountsA.length > 0 && amountsB.length > 0 && sameStringSet(amountsA, amountsB);
  }

  // 其它事件只有在标题事件指纹严格一致时合并，避免同主体同日多次动作被吞并。
  return compactTitle(a.title) === compactTitle(b.title);
}

function materialConflict(a: Candidate, b: Candidate): boolean {
  const amounts = (value: string) => [...value.matchAll(/\d+(?:\.\d+)?\s*(?:亿|千万|百万|亿元|亿美元|万美元|港元|人民币)/g)].map((match) => match[0]!.replace(/\s+/g, "")).sort();
  const left = amounts(`${a.title} ${a.content}`);
  const right = amounts(`${b.title} ${b.content}`);
  if (left.length > 0 && right.length > 0 && left.some((value) => !right.includes(value)) && right.some((value) => !left.includes(value))) return true;
  const rounds = (value: string) => financingRounds(value);
  const leftRounds = rounds(`${a.title} ${a.content}`);
  const rightRounds = rounds(`${b.title} ${b.content}`);
  return leftRounds.length > 0 && rightRounds.length > 0
    && leftRounds.some((value) => !rightRounds.includes(value))
    && rightRounds.some((value) => !leftRounds.includes(value));
}

function financingRounds(value: string): string[] {
  return [...value.matchAll(/(?:pre[-\s]?)?[a-f](?:\+|\d)?\s*轮/gi)]
    .map((match) => match[0]!.replace(/\s+|轮/g, "").toUpperCase())
    .filter((round) => round.length >= 1)
    .filter((round, index, list) => list.indexOf(round) === index)
    .sort();
}

function conflictDate(candidate: Candidate): number | null {
  const value = candidate.eventDate || (!candidate.timeUnconfirmed ? candidate.publishedAt : null);
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function financingRoundConflict(a: Candidate, b: Candidate): NonNullable<Candidate["conflicts"]>[number] | null {
  if (eventThemeKey(a.title, a.content) !== "financing" || eventThemeKey(b.title, b.content) !== "financing") return null;
  const entityA = extractEventEntity(a.title, a.content);
  const entityB = extractEventEntity(b.title, b.content);
  if (!entityA || !entityB || entityA !== entityB) return null;
  const roundsA = financingRounds(`${a.title} ${a.content}`);
  const roundsB = financingRounds(`${b.title} ${b.content}`);
  if (!roundsA.length || !roundsB.length || !roundsA.some((value) => !roundsB.includes(value)) || !roundsB.some((value) => !roundsA.includes(value))) return null;
  const dateA = conflictDate(a);
  const dateB = conflictDate(b);
  if (dateA === null || dateB === null || Math.abs(dateA - dateB) / 86400000 > 14) return null;
  return {
    type: "financing-round",
    reason: "same-entity-near-date-different-round",
    entity: entityA,
    values: [...new Set([...roundsA, ...roundsB])].sort(),
    relatedSourceUrls: [...new Set([...(a.sourceUrls ?? []), ...(b.sourceUrls ?? []), a.sourceUrl, b.sourceUrl].filter((url): url is string => !!url))].sort(),
  };
}

function appendConflict(candidate: Candidate, conflict: NonNullable<Candidate["conflicts"]>[number]): void {
  const key = `${conflict.type}|${conflict.entity}|${conflict.values.join(",")}|${conflict.relatedSourceUrls.join(",")}`;
  const existing = candidate.conflicts ?? [];
  if (!existing.some((item) => `${item.type}|${item.entity}|${item.values.join(",")}|${item.relatedSourceUrls.join(",")}` === key)) candidate.conflicts = [...existing, conflict];
}

function evidenceRank(candidate: Candidate): number {
  return candidate.evidenceStatus === "full" ? 3 : candidate.evidenceStatus === "partial" ? 2 : 0;
}

function publicationRank(candidate: Candidate): number {
  return candidate.publishedAtConfidence === "high" ? 3 : candidate.publishedAtConfidence === "medium" ? 2 : candidate.publishedAtConfidence === "low" ? 1 : 0;
}

function primaryCandidateRank(candidate: Candidate): Array<number | string> {
  return [
    evidenceRank(candidate),
    sourceQualityRank(candidate.sourceTier),
    publicationRank(candidate),
    candidate.timeUnconfirmed ? 0 : 1,
    candidate.sourceUrl || "",
  ];
}

function shouldReplacePrimary(current: Candidate, candidate: Candidate): boolean {
  const left = primaryCandidateRank(current);
  const right = primaryCandidateRank(candidate);
  for (let index = 0; index < left.length; index++) {
    if (left[index] === right[index]) continue;
    return right[index]! > left[index]!;
  }
  return false;
}

function syncPrimaryEvidence(target: Candidate, source: Candidate): void {
  target.id = source.id;
  target.title = source.title;
  target.content = source.content;
  target.summary = source.summary;
  target.investmentNote = source.investmentNote;
  target.source = source.source;
  target.sourceUrl = source.sourceUrl;
  target.sourceTier = source.sourceTier;
  target.origin = source.origin;
  target.domain = source.domain;
  target.publishedAt = source.publishedAt;
  target.publishedAtSource = source.publishedAtSource;
  target.publishedAtConfidence = source.publishedAtConfidence;
  target.timeUnconfirmed = source.timeUnconfirmed;
  target.evidenceStatus = source.evidenceStatus;
  target.eventDate = source.eventDate;
  target.eventTimeText = source.eventTimeText;
  target.eventDateSupport = source.eventDateSupport;
  target.eventType = source.eventType;
  target.subject = source.subject;
  target.region = source.region;
  target.relevance = source.relevance;
  target.relevanceReason = source.relevanceReason;
  target.importance = source.importance;
  target.followUpReason = source.followUpReason;
}

/** 转载合并：同底层事件只保留一张卡片，聚合来源。 */
export function mergeEventCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    for (const item of merged) {
      const conflict = financingRoundConflict(item, candidate);
      if (conflict) {
        appendConflict(item, conflict);
        appendConflict(candidate, conflict);
      }
    }
    const existing = merged.find((item) => {
      if (materialConflict(item, candidate)) return false;
      // 同一篇来源可同时披露融资、并购等多个事件，URL 相同不能单独作为去重依据。
      return sameUnderlyingEvent(item, candidate);
    });
    if (!existing) {
      merged.push({
        ...candidate,
        sourceUrls: [...new Set([...(candidate.sourceUrls ?? []), candidate.sourceUrl].filter((url): url is string => !!url))],
      });
      continue;
    }
    const existingVerifiedFact = existing.kind === "fact" && evidenceRank(existing) > 0;
    const candidateVerifiedFact = candidate.kind === "fact" && evidenceRank(candidate) > 0;
    const combinedConflicts = [...(existing.conflicts ?? []), ...(candidate.conflicts ?? [])];
    const urls = [...new Set([...(existing.sourceUrls ?? []), ...(candidate.sourceUrls ?? []), existing.sourceUrl, candidate.sourceUrl].filter((url): url is string => !!url))];
    if (shouldReplacePrimary(existing, candidate)) syncPrimaryEvidence(existing, candidate);
    existing.sourceUrls = urls.sort();
    existing.conflicts = combinedConflicts.length ? combinedConflicts.filter((item, index, list) => list.findIndex((other) => other.type === item.type && other.entity === item.entity && other.values.join(",") === item.values.join(",") && other.relatedSourceUrls.join(",") === item.relatedSourceUrls.join(",")) === index) : undefined;
    if ((candidate.sourceUrls?.length ?? 0) + 1 > 1 || urls.length > 1) {
      existing.confidence = existing.confidence === "low" ? "medium" : existing.confidence;
    }
    const verifiedFact = existingVerifiedFact || candidateVerifiedFact;
    existing.kind = verifiedFact ? "fact" : "other";
    existing.isClue = !verifiedFact;
    if (!verifiedFact && !existing.followUpReason) existing.followUpReason = "当前合并来源中尚无足够正文证据支持作为已确认事实";
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
