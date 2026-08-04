import type { IntelligenceTaskInput, ScheduleConfig } from "@/lib/intelligence";

export interface IntelligencePlan {
  task: IntelligenceTaskInput;
  questions: string[];
}

const DEFAULT_TIMEZONE = "Asia/Shanghai";

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

function parseTime(text: string): string | undefined {
  const match = text.match(/(上午|下午|晚上|早上|中午)?\s*(\d{1,2})(?:[点时](\d{1,2})分?)?/);
  if (!match) return undefined;
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? 0);
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

function parseLookback(text: string): { kind: "days"; value: number } {
  const days = firstMatch(text, /最近\s*(\d+)\s*(?:天|日)/);
  if (days) return { kind: "days", value: Math.max(1, Math.min(365, Number(days))) };
  if (/最近一周|最近一星期|近一周/.test(text)) return { kind: "days", value: 7 };
  if (/最近24小时|过去24小时|近24小时/.test(text)) return { kind: "days", value: 1 };
  if (/最近一个月|近一个月/.test(text)) return { kind: "days", value: 30 };
  return { kind: "days", value: 3 };
}

function parseMaxItems(text: string): number {
  const raw = firstMatch(text, /(?:不超过|最多|至多|控制在)\s*(\d+)\s*条?/);
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
  const matches = text.match(/(?:关注|整理|跟踪|监测|观察)([^，。；,。]{2,24})/g) ?? [];
  for (const match of matches) {
    const value = match.replace(/^(关注|整理|跟踪|监测|观察)/, "").trim();
    if (value) topics.push(value.replace(/^(最近|国内|海外)/, "").trim());
  }
  for (const known of ["AI赛事", "人工智能", "新能源汽车", "基金", "机构", "政策", "监管", "医疗", "芯片"]) {
    if (text.includes(known)) topics.push(known);
  }
  return unique(topics);
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
  const excludeMatch = text.match(/(?:排除|不要|不看|不包含)([^，。；,]+)/);
  if (excludeMatch) exclude.push(...excludeMatch[1].split(/[、和及]/));
  return { include: unique(include), exclude: unique(exclude) };
}

export function parseNaturalLanguageFallback(description: string): IntelligencePlan {
  const text = description.trim();
  const topics = parseTopics(text);
  const entities = parseEntities(text);
  const regions = parseRegions(text);
  const { include, exclude } = parseIncludeExclude(text);
  const scheduled = /每天|每日|定时|每周|星期[一二三四五六日天]|周[一二三四五六日天]/.test(text);
  const weekdays = parseWeekdays(text);
  const scheduleConfig: ScheduleConfig | null = scheduled ? {
    frequency: weekdays.length > 0 || /每周|星期|周[一二三四五六日天]/.test(text) ? "weekly" : "daily",
    weekdays: weekdays.length > 0 ? weekdays : [1],
    time: parseTime(text) ?? "09:00",
    timezone: DEFAULT_TIMEZONE,
  } : null;
  const questions: string[] = [];
  if (topics.length === 0 && entities.length === 0) questions.push("你最想持续关注哪个行业、公司、机构或赛事？");
  if (scheduled && !parseTime(text) && weekdays.length === 0) questions.push("希望在每周哪一天、几点生成？");
  const outputInstructions = [
    text.includes("合并") ? "同一主体或同一赛事的信息合并" : "",
    text.includes("事实") ? "区分重要事实与趋势信号" : "",
  ].filter(Boolean).join("；");
  return {
    task: {
      name: inferName(text, topics, entities), topics, entities, keywords: [], regions,
      includeRequirements: include, excludeRequirements: exclude, maxItems: parseMaxItems(text),
      lookbackPeriod: parseLookback(text), outputInstructions, executionMode: scheduled ? "scheduled" : "manual",
      scheduleConfig, isActive: true,
    },
    questions,
  };
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回格式无效");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function planFromAI(description: string, rawText: string): IntelligencePlan {
  const fallback = parseNaturalLanguageFallback(description);
  const raw = parseJson(rawText) as { task?: Record<string, unknown>; questions?: unknown };
  const task = raw.task && typeof raw.task === "object" ? raw.task : {};
  const merged: IntelligenceTaskInput = {
    name: typeof task.name === "string" ? task.name : fallback.task.name,
    topics: Array.isArray(task.topics) ? task.topics.filter((v): v is string => typeof v === "string") : fallback.task.topics,
    entities: Array.isArray(task.entities) ? task.entities.filter((v): v is string => typeof v === "string") : fallback.task.entities,
    keywords: Array.isArray(task.keywords) ? task.keywords.filter((v): v is string => typeof v === "string") : fallback.task.keywords,
    regions: Array.isArray(task.regions) ? task.regions.filter((v): v is string => typeof v === "string") : fallback.task.regions,
    includeRequirements: Array.isArray(task.includeRequirements) ? task.includeRequirements.filter((v): v is string => typeof v === "string") : fallback.task.includeRequirements,
    excludeRequirements: Array.isArray(task.excludeRequirements) ? task.excludeRequirements.filter((v): v is string => typeof v === "string") : fallback.task.excludeRequirements,
    maxItems: typeof task.maxItems === "number" ? task.maxItems : fallback.task.maxItems,
    lookbackPeriod: task.lookbackPeriod && typeof task.lookbackPeriod === "object" ? task.lookbackPeriod as IntelligenceTaskInput["lookbackPeriod"] : fallback.task.lookbackPeriod,
    outputInstructions: typeof task.outputInstructions === "string" ? task.outputInstructions : fallback.task.outputInstructions,
    executionMode: task.executionMode === "scheduled" ? "scheduled" : fallback.task.executionMode,
    scheduleConfig: task.scheduleConfig && typeof task.scheduleConfig === "object" ? task.scheduleConfig as ScheduleConfig : fallback.task.scheduleConfig,
    isActive: true,
  };
  const questions = Array.isArray(raw.questions) ? raw.questions.filter((v): v is string => typeof v === "string").slice(0, 2) : fallback.questions;
  return { task: merged, questions };
}

export const INTELLIGENCE_PARSE_SYSTEM = `你负责把用户的一句话关注描述整理为情报任务配置。只输出 JSON，不要解释。
JSON 结构必须是：{"task":{"name":string,"topics":string[],"entities":string[],"keywords":string[],"regions":string[],"includeRequirements":string[],"excludeRequirements":string[],"maxItems":number,"lookbackPeriod":{"kind":"days"|"custom","value"?:number,"start"?:string,"end"?:string},"outputInstructions":string,"executionMode":"manual"|"scheduled","scheduleConfig":null|{"frequency":"daily"|"weekly","weekdays":number[],"time":"HH:MM","timezone":string}},"questions":string[]}
规则：
- 只使用用户明确表达的信息；不确定的非关键字段使用克制默认值：最近3天、10条、手动生成、启用任务、Asia/Shanghai。
- 用户提到每天/每周/星期和时间时使用 scheduled，并解析星期、时间、时区；未提到生成节奏时使用 manual。
- 只有关注对象缺失，或用户明确要求定时但星期/时间无法判断时，才在 questions 中提出最少问题；否则 questions 为空。
- 不要添加新的字段，不要返回 Markdown 代码块。`;
