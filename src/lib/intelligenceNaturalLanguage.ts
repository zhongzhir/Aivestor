import type { IntelligenceTaskInput, ScheduleConfig } from "@/lib/intelligence";
import { normalizeIntelligenceTaskSemantics } from "@/lib/intelligenceTopicRelevance";

export interface IntelligencePlan {
  task: IntelligenceTaskInput;
  questions: string[];
}

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_SCHEDULE_TIME = "08:00";
const DEFAULT_WEEKDAY = 5;

function safeTimezone(value: string | undefined): string {
  if (!value) return DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return value; } catch { return DEFAULT_TIMEZONE; }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

function parseTime(text: string): string | undefined {
  const match = text.match(/(?:(上午|下午|晚上|早上|中午)?\s*(\d{1,2})(?:点|时)(?:(\d{1,2})分?)?|(\d{1,2})[:：](\d{2}))/);
  if (!match) return undefined;
  let hour = Number(match[2] ?? match[4]);
  const minute = Number(match[3] ?? match[5] ?? 0);
  if (match[1] === "下午" || match[1] === "晚上") hour = hour < 12 ? hour + 12 : hour;
  if (match[1] === "中午" && hour < 11) hour += 12;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseWeekdays(text: string): number[] {
  const result: number[] = [];
  if (/周日|星期日|星期天/.test(text)) result.push(0);
  if (/周一|星期一/.test(text)) result.push(1);
  if (/周二|星期二/.test(text)) result.push(2);
  if (/周三|星期三/.test(text)) result.push(3);
  if (/周四|星期四/.test(text)) result.push(4);
  if (/周五|星期五/.test(text)) result.push(5);
  if (/周六|星期六/.test(text)) result.push(6);
  return unique(result.map(String)).map(Number);
}

function dateAtUtcStart(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
}

function parseLookback(text: string, now: Date): IntelligenceTaskInput["lookbackPeriod"] {
  const custom = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?\s*(?:至|到|—|–|-)\s*(?:(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?|今天|今日|现在)/);
  if (custom) {
    const start = dateAtUtcStart(Number(custom[1]), Number(custom[2]), Number(custom[3]));
    const explicitEnd = custom[4] ? dateAtUtcStart(Number(custom[4]), Number(custom[5]), Number(custom[6])) : null;
    if (start) {
      const end = explicitEnd && explicitEnd < now ? explicitEnd : now;
      if (start < end) return { kind: "custom", start: start.toISOString(), end: end.toISOString() };
    }
  }
  const monthRange = parseMonthLookback(text, now);
  if (monthRange) return monthRange;
  const days = firstMatch(text, /最近\s*(\d+)\s*(?:天|日)/);
  if (days) return { kind: "days", value: Math.max(1, Math.min(365, Number(days))) };
  if (/最近一周|最近一星期|近一周/.test(text)) return { kind: "days", value: 7 };
  if (/(?:看看|了解|收集|查找|研究|整理|汇总|分析)?.{0,8}(?:今天|今日)/.test(text)) return { kind: "days", value: 1 };
  if (/最近24小时|过去24小时|近24小时/.test(text)) return { kind: "days", value: 1 };
  if (/最近一个月|近一个月/.test(text)) return { kind: "days", value: 30 };
  return { kind: "days", value: 3 };
}

/**
 * 解析月份范围：显式「2026年8月」或裸「8月」。
 * - 显式年份+月：范围为该自然月；结束时间收敛到 now（未来月份数据尚不存在）。
 * - 裸月（无年份）：取最近一次已到达的该月（当月即本月），结束时间收敛到 now。
 * 排除「一个月」「3个月」等时长表达（不视为 1 月/3 月）。
 */
function parseMonthLookback(text: string, now: Date): IntelligenceTaskInput["lookbackPeriod"] | null {
  const explicit = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
  if (explicit) {
    const year = Number(explicit[1]);
    const month = Number(explicit[2]);
    if (month < 1 || month > 12) return null;
    const start = dateAtUtcStart(year, month, 1);
    if (!start) return null;
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0));
    const end = lastDayOfMonth.getTime() <= now.getTime() ? lastDayOfMonth : now;
    if (start.getTime() < end.getTime()) return { kind: "custom", start: start.toISOString(), end: end.toISOString() };
    return null;
  }
  const bare = text.match(/(?<![0-9个])(\d{1,2})\s*月(?!个)/);
  if (!bare) return null;
  const month = Number(bare[1]);
  if (month < 1 || month > 12) return null;
  let year = now.getUTCFullYear();
  if (month > now.getUTCMonth() + 1) year -= 1;
  const start = dateAtUtcStart(year, month, 1);
  if (!start) return null;
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0));
  const end = lastDayOfMonth.getTime() <= now.getTime() ? lastDayOfMonth : now;
  if (start.getTime() < end.getTime()) return { kind: "custom", start: start.toISOString(), end: end.toISOString() };
  return null;
}

function parseMaxItems(text: string): number {
  const raw = firstMatch(text, /(?:不超过|最多|至多|控制在)\s*(\d+)\s*条/);
  return Math.max(1, Math.min(50, raw ? Number(raw) : 10));
}

function inferName(text: string, topics: string[], entities: string[]): string {
  if (entities.length > 0) return `${entities[0]}跟踪`;
  if (topics.length > 0) return `${topics[0]}跟踪`;
  const compact = text.replace(/[，。；,.].*$/, "").trim();
  return compact ? compact.slice(0, 24) : "自定义情报任务";
}

function parseRegions(text: string): string[] {
  const regions: string[] = [];
  const known = ["北京", "上海", "广州", "深圳", "杭州", "成都", "国内", "中国", "海外", "欧洲", "美国", "亚太"];
  for (const region of known) if (text.includes(region)) regions.push(region);
  return unique(regions);
}

function parseTopics(text: string): string[] {
  const topics: string[] = [];
  const cleanTopic = (value: string) => value
    .replace(/(?:20\d{2}\s*年\s*)?\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?/g, "")
    .replace(/最近\s*\d+\s*(?:天|日|周|星期)|最近一周|最近一个月|近一周|近一个月/g, "")
    .replace(/^(中国|国内|全球|海外|北京|上海|广州|深圳|杭州|成都)/, "")
    .replace(/(资本|融资|投资|并购|收购|估值|IPO|上市|股权|募资|政策|监管|行业|市场)(?:动态|消息|变化|情况)?$/i, "")
    .replace(/(企业|公司|机构)$/g, "")
    .trim();
  const matches = text.match(/(?:关注|整理|跟踪|监测|观察)([^，。；,。]{2,24})/g) ?? [];
  for (const match of matches) {
    const value = match.replace(/^(关注|整理|跟踪|监测|观察)/, "").trim();
    const cleaned = cleanTopic(value);
    if (cleaned) topics.push(cleaned);
  }
  for (const known of ["AI赛事", "人工智能", "新能源汽车", "基金", "机构", "医疗", "芯片", "创新药", "商业航天"]) {
    if (text.includes(known)) topics.push(known);
  }
  // 对“某行业/企业 + 事件类型”的短语保留用户明确的研究对象，
  // 避免后续只按“资本事件”筛选而把其他行业结果混入。
  const subject = text.match(/(?:中国|国内|全球|海外)?([\u4e00-\u9fffA-Za-z0-9]{2,18}?)(?:企业|公司|机构)?(?:的)?(?:资本|融资|投资|并购|IPO|上市|政策|行业|市场)(?:动态|消息|变化|情况)?/);
  if (subject?.[1]) {
    const cleaned = cleanTopic(subject[1]);
    if (cleaned) topics.push(cleaned);
  }
  return unique(topics.map(cleanTopic));
}

function parseEntities(text: string): string[] {
  const value = firstMatch(text, /(?:公司|主体|机构)[:：]?\s*([^，。；,]+)/);
  return value ? unique(value.split(/[、和及\s]+/)) : [];
}

function parseIncludeExclude(text: string): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const value of ["有奖金", "有明确奖金", "适合我的项目参赛", "适合我的项目", "有融资信息", "有政策影响"]) {
    if (text.includes(value)) include.push(value);
  }
  for (const value of ["融资", "投资", "并购", "收购", "估值", "IPO", "上市", "股权", "募资", "授权", "合作", "BD", "资本动态"]) {
    if (text.includes(value)) include.push(value);
  }
  const excludeMatch = text.match(/(?:排除|不要|不看|不包含)([^，。；,]+)/);
  if (excludeMatch) exclude.push(...excludeMatch[1].split(/[、和及]/));
  return { include: unique(include), exclude: unique(exclude) };
}

export function parseNaturalLanguageFallback(description: string, userTimezone = DEFAULT_TIMEZONE): IntelligencePlan {
  return parseNaturalLanguageFallbackAt(description, userTimezone, new Date());
}

export function parseNaturalLanguageFallbackAt(description: string, userTimezone = DEFAULT_TIMEZONE, now = new Date()): IntelligencePlan {
  const text = description.trim();
  const topics = parseTopics(text);
  const entities = parseEntities(text);
  const regions = parseRegions(text);
  const { include, exclude } = parseIncludeExclude(text);
  const scheduled = /每天|每日|每周|持续|定期|定时|星期[一二三四五六日天]|周[一二三四五六日天]/.test(text);
  const weekdays = parseWeekdays(text);
  const time = parseTime(text);
  const explicitlyDaily = /每天|每日/.test(text);
  const weekly = !explicitlyDaily && (weekdays.length > 0 || /每周|星期|周[一二三四五六日天]|持续|定期|定时/.test(text));
  const scheduleConfig: ScheduleConfig | null = scheduled ? {
    frequency: weekly ? "weekly" : "daily",
    weekdays: weekly ? (weekdays.length > 0 ? weekdays : [DEFAULT_WEEKDAY]) : undefined,
    time: time ?? DEFAULT_SCHEDULE_TIME,
    timezone: safeTimezone(userTimezone),
  } : null;
  const outputInstructions = text;
  return {
    task: normalizeIntelligenceTaskSemantics({
      name: inferName(text, topics, entities), topics, entities, keywords: [], regions,
      includeRequirements: include, excludeRequirements: exclude, maxItems: parseMaxItems(text),
      lookbackPeriod: parseLookback(text, now), outputInstructions, executionMode: scheduled ? "scheduled" : "manual",
      scheduleConfig, isActive: true,
    }),
    questions: [],
  };
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回格式无效");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function planFromAI(description: string, rawText: string, userTimezone = DEFAULT_TIMEZONE): IntelligencePlan {
  const fallback = parseNaturalLanguageFallback(description, userTimezone);
  const raw = parseJson(rawText) as { task?: Record<string, unknown>; questions?: unknown };
  const task = raw.task && typeof raw.task === "object" ? raw.task : {};
  const cleanList = (value: unknown, fallbackValue: string[]) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 100)).filter(Boolean).slice(0, 20) : fallbackValue;
  const rawLookback = task.lookbackPeriod && typeof task.lookbackPeriod === "object" ? task.lookbackPeriod as Record<string, unknown> : null;
  // 日期是用户研究意图的硬约束。AI 可能把“8月”猜成历史年份，
  // 因此只要兜底解析出了明确范围，就不得用 AI 返回值覆盖。
  const lookbackPeriod: IntelligenceTaskInput["lookbackPeriod"] = fallback.task.lookbackPeriod.kind === "custom"
    ? fallback.task.lookbackPeriod
    : rawLookback?.kind === "custom"
      ? { kind: "custom", start: typeof rawLookback.start === "string" ? rawLookback.start : undefined, end: typeof rawLookback.end === "string" ? rawLookback.end : undefined }
      : { kind: "days", value: Math.max(1, Math.min(365, Number(rawLookback?.value) || fallback.task.lookbackPeriod.value || 3)) };
  const chooseExplicit = (aiValue: unknown, fallbackValue: string[]) => fallbackValue.length > 0 ? fallbackValue : cleanList(aiValue, fallbackValue);
  const merged: IntelligenceTaskInput = {
    name: typeof task.name === "string" ? task.name.trim().slice(0, 120) || fallback.task.name : fallback.task.name,
    topics: chooseExplicit(task.topics, fallback.task.topics), entities: chooseExplicit(task.entities, fallback.task.entities), keywords: chooseExplicit(task.keywords, fallback.task.keywords), regions: chooseExplicit(task.regions, fallback.task.regions),
    includeRequirements: chooseExplicit(task.includeRequirements, fallback.task.includeRequirements), excludeRequirements: chooseExplicit(task.excludeRequirements, fallback.task.excludeRequirements),
    maxItems: Math.max(1, Math.min(50, Number(task.maxItems) || fallback.task.maxItems)), lookbackPeriod,
    outputInstructions: typeof task.outputInstructions === "string" ? task.outputInstructions.trim().slice(0, 500) || fallback.task.outputInstructions : fallback.task.outputInstructions,
    executionMode: fallback.task.executionMode, scheduleConfig: fallback.task.executionMode === "scheduled" ? fallback.task.scheduleConfig : null,
    isActive: true,
  };
  const questions = fallback.questions.length > 0 ? fallback.questions : [];
  return { task: normalizeIntelligenceTaskSemantics(merged), questions };
}

export function planFromAIOrFallback(description: string, rawText: string, userTimezone = DEFAULT_TIMEZONE): IntelligencePlan {
  try { return planFromAI(description, rawText, userTimezone); } catch { return parseNaturalLanguageFallback(description, userTimezone); }
}

export const INTELLIGENCE_PARSE_SYSTEM = `你负责把用户的一句话关注描述整理为情报任务配置。只输出 JSON，不要解释。
JSON 结构必须是：{"task":{"name":string,"topics":string[],"entities":string[],"keywords":string[],"regions":string[],"includeRequirements":string[],"excludeRequirements":string[],"maxItems":number,"lookbackPeriod":{"kind":"days"|"custom","value"?:number,"start"?:string,"end"?:string},"outputInstructions":string,"executionMode":"manual"|"scheduled","scheduleConfig":null|{"frequency":"daily"|"weekly","weekdays":number[],"time":"HH:MM","timezone":string}},"questions":string[]}
规则：
- 只使用用户明确表达的信息；不确定的非关键字段使用克制默认值：最近3天、10条、手动生成、启用任务；时区使用请求提供的用户时区。
- 一次性收集、查找、研究、汇总、了解或分析是合法完整任务；这些动词不表示持续订阅。用户未明确表达每天、每周、持续、定期等周期意图时，必须使用 manual 且 scheduleConfig=null。
- 用户明确提出周期执行时才使用 scheduled，并解析星期、时间、时区。不得因为未写星期或时间而追问：每天任务默认上午8点；每周任务缺少星期时默认每周五，缺少时间时默认上午8点。
- 用户已经描述了研究对象或问题时，即使 topics/entities 为空也不得追问；能够使用常识或安全默认值完成的配置一律不得追问，questions 通常返回空数组。
- 明确日期范围使用 custom lookbackPeriod，并保留用户的研究意图与输出要求（包括字数限制）。
- 明确「某年某月」（如 2026年8月）或裸月（如 8月）表示以该自然月为研究范围，使用 custom lookbackPeriod：start 为月初，end 不超过今天（今天由调用方提供当前日期）。
- topics 只放行业、技术、赛道或关注主题，例如“AI大模型”“创新药”“商业航天”；不要放“资本动态”“融资动态”“政策动态”“最新消息”等事件类型。
- entities 只放具体可识别的公司、机构、基金、政府部门或项目；不要放“中国AI大模型企业”“创新药公司”“商业航天企业”等泛化类别。
- keywords 可放融资、投资、并购、估值、IPO、授权交易等事件动作和检索提示。
- regions 表示关注地域范围；文章未字面出现地域名称，不代表地域冲突。
- 不要添加新的字段，不要返回 Markdown 代码块。`;
