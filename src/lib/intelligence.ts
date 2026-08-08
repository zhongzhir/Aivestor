import { query } from "@/lib/db";
import { getGenerationAccess, reserveIntelligenceQuota } from "@/lib/intelligenceGeneration";
import { searchWebForIntelligence, type WebSearchCredentials } from "@/lib/intelligenceWebSearch";

export type ExecutionMode = "manual" | "scheduled";
export type Feedback = "valuable" | "irrelevant";

export interface LookbackPeriod {
  kind: "days" | "custom";
  value?: number;
  start?: string;
  end?: string;
}

export interface ScheduleConfig {
  frequency: "daily" | "weekly";
  weekdays?: number[];
  time: string;
  timezone: string;
}

export interface IntelligenceTaskInput {
  name: string;
  topics: string[];
  entities: string[];
  keywords: string[];
  regions: string[];
  includeRequirements: string[];
  excludeRequirements: string[];
  maxItems: number;
  lookbackPeriod: LookbackPeriod;
  outputInstructions: string;
  executionMode: ExecutionMode;
  scheduleConfig: ScheduleConfig | null;
  isActive: boolean;
}

export interface Candidate {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string;
  subject: string;
  region: string | null;
  kind: "fact" | "trend" | "other";
  sourceTier?: "A" | "B" | "C" | "D";
  origin?: "web-search" | "trusted-source" | "market-insights";
  domain?: string;
  matchedTerms?: string[];
  sourceUrls?: string[];
  importance?: "high" | "medium" | "low";
  relevance?: "high" | "medium" | "low";
  confidence?: "high" | "medium" | "low";
}

interface SourceItemRow {
  id: string;
  source_key: string;
  source_name: string;
  source_homepage: string;
  canonical_url: string;
  title: string;
  summary: string;
  published_at: string;
  subjects: string[];
}

export interface BriefItem extends Candidate {
  feedback?: Feedback;
}

export interface BriefResult {
  taskName: string;
  coverageStart: string;
  coverageEnd: string;
  generatedAt: string;
  itemCount: number;
  importantFacts: BriefItem[];
  trendSignals: BriefItem[];
  otherItems: BriefItem[];
  sourceList: Array<{ source: string; url: string | null; publishedAt: string; sourceTier?: "A" | "B" | "C" | "D"; origin?: string }>;
  metadata: { overview: string; origins: string[] };
}

function titleTokens(title: string): Set<string> { return new Set(title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length > 1)); }
function compactTitle(title: string): string { return title.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
export function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const tokens = titleTokens(candidate.title);
    const existing = merged.find((item) => {
      const days = Math.abs(new Date(item.publishedAt).getTime() - new Date(candidate.publishedAt).getTime()) / 86400000;
      if (days > 14) return false;
      if (item.sourceUrl && candidate.sourceUrl && item.sourceUrl === candidate.sourceUrl) return true;
      const compactA = compactTitle(item.title); const compactB = compactTitle(candidate.title);
      if (compactA === compactB || compactA.includes(compactB) || compactB.includes(compactA)) return true;
      const other = titleTokens(item.title); const overlap = [...tokens].filter((token) => other.has(token)).length;
      return overlap >= 2 && overlap / Math.max(2, Math.min(tokens.size, other.size)) >= 0.55;
    });
    if (!existing) { merged.push({ ...candidate, sourceUrls: candidate.sourceUrl ? [candidate.sourceUrl] : [] }); continue; }
    const urls = [...new Set([...(existing.sourceUrls ?? []), ...(candidate.sourceUrls ?? []), candidate.sourceUrl].filter((url): url is string => !!url))];
    existing.sourceUrls = urls;
    existing.source = [...new Set(`${existing.source}; ${candidate.source}`.split(/;\s*/).filter(Boolean))].join("; ");
    existing.sourceTier = existing.sourceTier === "A" || candidate.sourceTier !== "A" ? existing.sourceTier : candidate.sourceTier;
    if (candidate.kind === "fact" && existing.kind !== "fact") existing.kind = candidate.kind;
  }
  return merged;
}

function candidateMarkdown(candidate: Candidate, input: IntelligenceTaskInput): string {
  const confidence = candidate.confidence === "high" ? "高" : candidate.confidence === "medium" ? "中" : "低";
  const corroboration = (candidate.sourceUrls?.length ?? 1) > 1 ? "，已有多来源交叉印证" : "，当前为单一来源，建议结合其他来源核验";
  return `**发生了什么**\n\n${candidate.content || candidate.title}\n\n**为什么值得关注**\n\n该信息直接匹配本次关注主题（${[...input.topics, ...input.entities, ...input.keywords].filter(Boolean).slice(0, 4).join("、") || "用户订制主题"}）。\n\n**可信度**\n\n${confidence}（来源等级 ${candidate.sourceTier ?? "C"}${corroboration}）。\n\n**时间**\n\n${new Date(candidate.publishedAt).toLocaleString("zh-CN")}`;
}

export function validateTaskInput(input: IntelligenceTaskInput, now = new Date()): string | null {
  if (!input.name || input.name.length > 200) return "任务名称长度必须为 1-200 个字符";
  if (input.executionMode === "scheduled") {
    const schedule = input.scheduleConfig;
    if (!schedule || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return "定时任务的时间必须是 HH:MM";
    try { new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }).format(now); } catch { return "时区无效"; }
    if (schedule.frequency === "weekly" && (!schedule.weekdays?.length || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) return "每周任务必须选择有效星期";
  }
  if (input.lookbackPeriod.kind === "custom") {
    const start = new Date(input.lookbackPeriod.start ?? "");
    const end = new Date(input.lookbackPeriod.end ?? "");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return "自定义时间范围无效";
    if (end > now) return "自定义结束时间不能晚于当前时间";
  }
  return null;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

function textMatches(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = text.toLocaleLowerCase();
  return terms.some((term) => haystack.includes(term.toLocaleLowerCase()));
}

export function filterCandidates(candidates: Candidate[], input: IntelligenceTaskInput, start: Date, end: Date): Candidate[] {
  const include = [...input.topics, ...input.entities, ...input.keywords, ...input.regions, ...input.includeRequirements];
  const exclude = input.excludeRequirements;
  const result = candidates.filter((candidate) => {
    const publishedAt = new Date(candidate.publishedAt);
    if (publishedAt < start || publishedAt > end) return false;
    const text = [candidate.title, candidate.content, candidate.subject, candidate.region ?? ""].join(" ");
    if (!textMatches(text, include)) return false;
    if (exclude.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false;
    return true;
  });

  const bySubject = new Map<string, Candidate>();
  for (const candidate of result) {
    const key = candidate.subject.trim().toLocaleLowerCase() || candidate.title.trim().toLocaleLowerCase();
    const previous = bySubject.get(key);
    if (!previous || new Date(candidate.publishedAt) > new Date(previous.publishedAt)) bySubject.set(key, candidate);
  }
  return [...bySubject.values()].sort((a, b) => {
    const rank = { fact: 3, trend: 2, other: 1 };
    return rank[b.kind] - rank[a.kind] || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  }).slice(0, Math.max(1, Math.min(50, input.maxItems)));
}

export function normalizeTaskInput(body: Record<string, unknown>): IntelligenceTaskInput {
  const mode = body.executionMode === "scheduled" ? "scheduled" : "manual";
  const schedule = body.scheduleConfig && typeof body.scheduleConfig === "object" ? body.scheduleConfig as Record<string, unknown> : null;
  const scheduleConfig = mode === "scheduled" ? {
    frequency: schedule?.frequency === "weekly" ? "weekly" : "daily",
    weekdays: Array.isArray(schedule?.weekdays) ? schedule!.weekdays.filter((v): v is number => typeof v === "number") : undefined,
    time: typeof schedule?.time === "string" ? schedule.time : "09:00",
    timezone: typeof schedule?.timezone === "string" ? schedule.timezone : "Asia/Shanghai",
  } as ScheduleConfig : null;
  const lookback = body.lookbackPeriod && typeof body.lookbackPeriod === "object" ? body.lookbackPeriod as Record<string, unknown> : { kind: "days", value: 3 };
  return {
    name: typeof body.name === "string" ? body.name.trim() : "",
    topics: asList(body.topics), entities: asList(body.entities), keywords: asList(body.keywords), regions: asList(body.regions),
    includeRequirements: asList(body.includeRequirements), excludeRequirements: asList(body.excludeRequirements),
    maxItems: Math.max(1, Math.min(50, Number(body.maxItems) || 10)),
    lookbackPeriod: { kind: lookback.kind === "custom" ? "custom" : "days", value: Number(lookback.value) || 3, start: typeof lookback.start === "string" ? lookback.start : undefined, end: typeof lookback.end === "string" ? lookback.end : undefined },
    outputInstructions: typeof body.outputInstructions === "string" ? body.outputInstructions.trim() : "",
    executionMode: mode, scheduleConfig, isActive: body.isActive === true,
  };
}

export function coverageFor(input: IntelligenceTaskInput, now = new Date()): { start: Date; end: Date } {
  if (input.lookbackPeriod.kind === "custom" && input.lookbackPeriod.start && input.lookbackPeriod.end) return { start: new Date(input.lookbackPeriod.start), end: new Date(input.lookbackPeriod.end) };
  const days = Math.max(1, Math.min(365, input.lookbackPeriod.value || 3));
  return { start: new Date(now.getTime() - days * 86400000), end: now };
}

export async function loadCandidates(start: Date, end: Date): Promise<Candidate[]> {
  let externalRows: SourceItemRow[] = [];
  try {
    externalRows = await query<SourceItemRow>(
      `SELECT id, source_key, source_name, source_homepage, canonical_url, title, summary, published_at, subjects
         FROM intelligence_source_items
        WHERE published_at BETWEEN $1 AND $2
        ORDER BY published_at DESC
        LIMIT 300`, [start.toISOString(), end.toISOString()]
    );
  } catch (error) {
    // 迁移尚未执行时保持旧生产版本可用，部署窗口内继续使用内部降级源。
    console.warn("[intelligence] external source table unavailable; using market_insights fallback", error instanceof Error ? error.message : error);
  }
  if (externalRows.length > 0) {
    return externalRows.map((row) => ({
      id: row.id,
      title: row.title,
      content: `${row.summary || row.title} ${row.subjects?.join(" ") ?? ""}`.trim(),
      source: row.source_name,
      sourceUrl: row.canonical_url || row.source_homepage,
      publishedAt: row.published_at,
      subject: row.source_name,
      region: null,
      kind: /安全|政策|发布|融资|合作|模型|产品|研究|投资/.test(`${row.title}${row.summary}`) ? "trend" : "fact",
      sourceTier: "A", origin: "trusted-source", domain: (() => { try { return new URL(row.canonical_url || row.source_homepage).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
    }));
  }

  // 外部采集暂时没有数据时保留内部市场洞察的降级能力；结果明确标记来源，
  // 不再把它当作全网监测结果。
  const rows = await query<{ id: string; title: string; content: string; generated_at: string; data_as_of: string }>(
    `SELECT id, title, content, generated_at, data_as_of::text AS data_as_of
       FROM market_insights
      WHERE generated_at BETWEEN $1 AND $2 OR data_as_of BETWEEN $1::date AND $2::date
      ORDER BY generated_at DESC`, [start.toISOString(), end.toISOString()]
  );
  return rows.map((row) => ({ id: row.id, title: row.title, content: row.content, source: "market-insights / 中鉴内部数据（降级）", sourceUrl: null, publishedAt: row.generated_at || `${row.data_as_of}T00:00:00.000Z`, subject: row.title, region: null, kind: /趋势|增长|变化|融资|政策/.test(`${row.title}${row.content}`) ? "trend" : "fact", sourceTier: "D", origin: "market-insights" }));
}

function scoreCandidates(candidates: Candidate[], input: IntelligenceTaskInput): Candidate[] {
  const terms = [...input.topics, ...input.entities, ...input.keywords, ...input.includeRequirements].filter(Boolean);
  return candidates.map((candidate) => {
    const text = `${candidate.title} ${candidate.content}`.toLocaleLowerCase();
    const hits = terms.filter((term) => text.includes(term.toLocaleLowerCase())).length;
    const relevance: Candidate["relevance"] = hits >= 2 ? "high" : hits === 1 ? "medium" : "low";
    const importance: Candidate["importance"] = /融资|并购|收购|授权|交易|监管|政策|发布|重大|合作/.test(candidate.title) ? "high" : candidate.kind === "fact" ? "medium" : "low";
    const confidence: Candidate["confidence"] = candidate.sourceTier === "A" || (candidate.sourceUrls?.length ?? 0) > 1 ? "high" : candidate.sourceTier === "B" || candidate.sourceTier === "C" ? "medium" : "low";
    return { ...candidate, relevance, importance, confidence };
  }).sort((a, b) => {
    const rank = (value: Candidate["importance"] | Candidate["relevance"]): number => value === "high" ? 3 : value === "medium" ? 2 : 1;
    return rank(b.importance) + rank(b.relevance) - rank(a.importance) - rank(a.relevance);
  });
}

export async function generateBrief(userId: string, taskId: string, input: IntelligenceTaskInput, now = new Date(), scheduledSlot?: string, credentials?: WebSearchCredentials): Promise<{ id: string; brief: BriefResult }> {
  if (!input.isActive) throw new Error("停用的情报任务不能执行");
  const validationError = validateTaskInput(input, now);
  if (validationError) throw new Error(validationError);
  const coverage = coverageFor(input, now);
  const webCandidates: Candidate[] = (await searchWebForIntelligence(input, coverage.start, credentials)).map((item) => ({ id: `web:${item.url}`, title: item.title, content: item.snippet, source: item.siteName, sourceUrl: item.url, publishedAt: item.publishedAt || now.toISOString(), subject: item.title, region: null, kind: /融资|并购|发布|政策|合作|交易|投资|产品|模型|研究/.test(item.title) ? "fact" : "trend", sourceTier: item.sourceTier, origin: "web-search", domain: item.domain }));
  const candidates = scoreCandidates(mergeCandidates(filterCandidates([...webCandidates, ...(await loadCandidates(coverage.start, coverage.end))], input, coverage.start, coverage.end)), input).slice(0, Math.max(1, Math.min(50, input.maxItems))).map((candidate) => ({ ...candidate, content: candidateMarkdown(candidate, input) }));
  const origins = [...new Set(candidates.map((candidate) => candidate.origin ?? "trusted-source"))];
  const overview = candidates.length
    ? `本期共发现 ${candidates.length} 条符合条件的信息，主要来自${origins.includes("web-search") ? "百炼实时联网搜索" : "已采集可信来源"}${origins.includes("market-insights") ? "，并使用了内部市场数据作为补充" : ""}。重点事件按相关度、来源等级和时效性排序。`
    : "本期未发现符合条件的可信新增信息。";
  const brief: BriefResult = {
    taskName: input.name, coverageStart: coverage.start.toISOString(), coverageEnd: coverage.end.toISOString(), generatedAt: now.toISOString(), itemCount: candidates.length,
    importantFacts: candidates.filter((x) => x.kind === "fact"), trendSignals: candidates.filter((x) => x.kind === "trend"), otherItems: candidates.filter((x) => x.kind === "other"),
    sourceList: candidates.flatMap((x) => (x.sourceUrls?.length ? x.sourceUrls : [x.sourceUrl]).map((url) => ({ source: x.source, url, publishedAt: x.publishedAt, sourceTier: x.sourceTier ?? "C", origin: x.origin ?? "trusted-source" }))),
    metadata: { overview, origins },
  };
  const rows = await query<{ id: string }>(
    `INSERT INTO intelligence_briefs (task_id, user_id, task_name, coverage_start, coverage_end, generated_at, item_count, important_facts, trend_signals, other_items, source_list, metadata, scheduled_slot)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13
       FROM intelligence_tasks
      WHERE id = $1 AND user_id = $2 AND is_active = true
     ON CONFLICT (task_id, scheduled_slot) WHERE scheduled_slot IS NOT NULL DO NOTHING RETURNING id`,
    [taskId, userId, brief.taskName, brief.coverageStart, brief.coverageEnd, brief.generatedAt, brief.itemCount, JSON.stringify(brief.importantFacts), JSON.stringify(brief.trendSignals), JSON.stringify(brief.otherItems), JSON.stringify(brief.sourceList), JSON.stringify(brief.metadata), scheduledSlot]
  );
  if (!rows[0] && scheduledSlot) {
    const existing = await query<{ id: string }>("SELECT id FROM intelligence_briefs WHERE task_id = $1 AND scheduled_slot = $2", [taskId, scheduledSlot]);
    if (existing[0]) return { id: existing[0].id, brief };
  }
  if (!rows[0]) throw new Error("任务已停用或删除");
  return { id: rows[0].id, brief };
}

export async function runScheduledTasks(now = new Date()): Promise<number> {
  const tasks = await query<{ id: string; user_id: string; name: string; topics: unknown; entities: unknown; keywords: unknown; regions: unknown; include_requirements: unknown; exclude_requirements: unknown; max_items: number; lookback_period: unknown; output_instructions: string; execution_mode: ExecutionMode; schedule_config: ScheduleConfig; is_active: boolean }>(
    `SELECT * FROM intelligence_tasks WHERE is_active = true AND execution_mode = 'scheduled'`
  );
  let count = 0;
  for (const task of tasks) {
    const cfg = task.schedule_config;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? -1);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    if (cfg.time !== `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` || (cfg.frequency === "weekly" && !(cfg.weekdays ?? []).includes(weekday))) continue;
    const year = parts.find((p) => p.type === "year")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    const scheduledSlot = `${year}-${month}-${day} ${cfg.time}`;
    try {
      const generation = await getGenerationAccess(task.user_id);
      if (!generation || (generation.source === "platform" && !(await reserveIntelligenceQuota(task.user_id)))) {
        await query("UPDATE intelligence_tasks SET is_active = false WHERE id = $1 AND user_id = $2", [task.id, task.user_id]);
        continue;
      }
      await generateBrief(task.user_id, task.id, normalizeTaskInput({ ...task, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: cfg, isActive: task.is_active }), now, scheduledSlot, generation.credentials);
      count++;
    } catch {
      // 额度或上游异常时暂停该任务，避免下一轮调度持续失败。
      await query("UPDATE intelligence_tasks SET is_active = false WHERE id = $1 AND user_id = $2", [task.id, task.user_id]);
    }
  }
  return count;
}
