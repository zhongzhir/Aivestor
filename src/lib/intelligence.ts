import { query } from "@/lib/db";
import { getGenerationAccess, reserveIntelligenceQuota } from "@/lib/intelligenceGeneration";
import { searchWebForIntelligence, type WebSearchCredentials } from "@/lib/intelligenceWebSearch";
import { isHistoricalReviewCandidate, topicRelevance } from "@/lib/intelligenceTopicRelevance";
import { acquireEvidence, type EvidenceStatus } from "@/lib/intelligenceEvidence";
import {
  buildEditorialOverview,
  enrichCandidate,
  mergeEventCandidates,
  partitionBriefItems,
  resolvePublishedAt,
  scoreAndSortCandidates,
} from "@/lib/intelligenceBriefQuality";

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
  sourceTier?: "S" | "A" | "B" | "C" | "D";
  origin?: "web-search" | "trusted-source" | "market-insights";
  domain?: string;
  matchedTerms?: string[];
  sourceUrls?: string[];
  importance?: "high" | "medium" | "low";
  relevance?: "high" | "medium" | "low";
  confidence?: "high" | "medium" | "low";
  /** 1～2 句事实摘要（不含模板话术） */
  summary?: string;
  /** 有证据时的投资观察；无则不展示 */
  investmentNote?: string;
  /** 发布时间无法从来源/URL 确认 */
  timeUnconfirmed?: boolean;
  /** 单一模糊来源，降级为线索 */
  isClue?: boolean;
  /** 面向用户的具体后续核查理由；仅在线索中展示。 */
  followUpReason?: string;
  /** 搜索结果正文取证状态；仅标题/snippet 的单源不得升级为事实。 */
  evidenceStatus?: EvidenceStatus;
  evidencePublishedAt?: string;
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
  sourceList: Array<{ source: string; url: string | null; publishedAt: string; sourceTier?: "S" | "A" | "B" | "C" | "D"; origin?: string }>;
  metadata: { overview: string; origins: string[] };
}

/** @deprecated 使用 mergeEventCandidates；保留导出名兼容既有测试 */
export function mergeCandidates(candidates: Candidate[]): Candidate[] {
  return mergeEventCandidates(candidates);
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
  const topics = input.topics;
  const regions = input.regions;
  const entities = input.entities;
  const soft = [...input.keywords, ...input.includeRequirements];
  const exclude = input.excludeRequirements;
  const result = candidates.filter((candidate) => {
    if (!candidate.timeUnconfirmed) {
      const publishedAt = new Date(candidate.publishedAt);
      if (!Number.isFinite(publishedAt.getTime()) || publishedAt < start || publishedAt > end) return false;
    }
    const text = [candidate.title, candidate.content, candidate.subject, candidate.region ?? ""].join(" ");
    if (exclude.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false;
    if (candidate.origin === "web-search" && !topicRelevance(candidate, input).passed) return false;
    if (candidate.origin === "web-search" && isHistoricalReviewCandidate(candidate, input)) return false;
    // 主题词存在时必须命中主题，避免仅因“融资/政策”等泛关键词误入
    if (topics.length && !textMatches(text, topics)) return false;
    if (regions.length && !textMatches(text, regions) && !textMatches(text, topics)) return false;
    if (!topics.length && !regions.length) {
      const include = [...entities, ...soft];
      if (!textMatches(text, include)) return false;
    } else if (entities.length && soft.length) {
      // 已通过主题/地域；实体为加分项，不强制
    } else if (!topics.length && regions.length && soft.length && !textMatches(text, soft) && !textMatches(text, entities)) {
      return false;
    }
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
  }).slice(0, Math.max(1, Math.min(50, input.maxItems * 3)));
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

function coveragePlaceholder(value?: string | null): string {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
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
    return externalRows.map((row) => {
      const resolved = resolvePublishedAt({ sourcePublishedAt: row.published_at, url: row.canonical_url });
      return {
        id: row.id,
        title: row.title,
        content: `${row.summary || row.title}`.trim(),
        source: row.source_name,
        sourceUrl: row.canonical_url || row.source_homepage,
        publishedAt: resolved.publishedAt || coveragePlaceholder(row.published_at),
        timeUnconfirmed: resolved.timeUnconfirmed,
        subject: row.source_name,
        region: null,
        kind: "fact" as const,
        sourceTier: "S" as const,
        origin: "trusted-source" as const,
        domain: (() => { try { return new URL(row.canonical_url || row.source_homepage).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
      };
    });
  }

  // 外部采集暂时没有数据时保留内部市场洞察的降级能力；结果明确标记来源，
  // 不再把它当作全网监测结果。
  const rows = await query<{ id: string; title: string; content: string; generated_at: string; data_as_of: string }>(
    `SELECT id, title, content, generated_at, data_as_of::text AS data_as_of
       FROM market_insights
      WHERE generated_at BETWEEN $1 AND $2 OR data_as_of BETWEEN $1::date AND $2::date
      ORDER BY generated_at DESC`, [start.toISOString(), end.toISOString()]
  );
  return rows.map((row) => {
    const resolved = resolvePublishedAt({ sourcePublishedAt: row.data_as_of ? `${row.data_as_of}T00:00:00.000Z` : null });
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      source: "market-insights / 中鉴内部数据（降级）",
      sourceUrl: null,
      publishedAt: resolved.publishedAt || coveragePlaceholder(row.generated_at),
      timeUnconfirmed: true,
      subject: row.title,
      region: null,
      kind: "other" as const,
      sourceTier: "D" as const,
      origin: "market-insights" as const,
      isClue: true,
    };
  });
}

function scoreCandidates(candidates: Candidate[], input: IntelligenceTaskInput): Candidate[] {
  return scoreAndSortCandidates(candidates, input);
}

export async function generateBrief(userId: string, taskId: string, input: IntelligenceTaskInput, now = new Date(), scheduledSlot?: string, credentials?: WebSearchCredentials): Promise<{ id: string; brief: BriefResult }> {
  if (!input.isActive) throw new Error("停用的情报任务不能执行");
  const validationError = validateTaskInput(input, now);
  if (validationError) throw new Error(validationError);
  const coverage = coverageFor(input, now);
  const webCandidates: Candidate[] = (await searchWebForIntelligence(input, coverage.start, credentials)).map((item) => {
    const resolved = resolvePublishedAt({
      sourcePublishedAt: item.publishedAt,
      url: item.url,
      collectedAt: now.toISOString(),
      generatedAt: now.toISOString(),
    });
    return {
      id: `web:${item.url}`,
      title: item.title,
      content: item.snippet,
      source: item.siteName,
      sourceUrl: item.url,
      publishedAt: resolved.publishedAt || coveragePlaceholder(null),
      timeUnconfirmed: resolved.timeUnconfirmed,
      subject: item.title,
      region: null,
      kind: "fact" as const,
      sourceTier: item.sourceTier,
      origin: "web-search" as const,
      domain: item.domain,
      evidenceStatus: "unavailable" as const,
    };
  });
  const filtered = filterCandidates([...webCandidates, ...(await loadCandidates(coverage.start, coverage.end))], input, coverage.start, coverage.end);
  // 先按现有候选评分截取高价值 URL，再做有限并发正文取证，避免每次任务抓取整个搜索结果集。
  const evidenceCandidates = scoreCandidates(filtered, input).slice(0, 16);
  await acquireEvidence(evidenceCandidates);
  for (const candidate of evidenceCandidates) {
    const resolved = resolvePublishedAt({ sourcePublishedAt: candidate.evidencePublishedAt, url: candidate.sourceUrl });
    if (candidate.evidencePublishedAt) {
      candidate.publishedAt = resolved.publishedAt || candidate.publishedAt;
      candidate.timeUnconfirmed = resolved.timeUnconfirmed;
    }
    delete candidate.evidencePublishedAt;
  }
  const merged = mergeEventCandidates(filtered);
  const enriched = scoreCandidates(
    merged.map((candidate) => enrichCandidate(candidate, input)),
    input,
  ).slice(0, Math.max(1, Math.min(50, input.maxItems)));
  const partitioned = partitionBriefItems(enriched);
  const orderedForOverview = [...partitioned.importantFacts, ...partitioned.trendSignals, ...partitioned.otherItems];
  const origins = [...new Set(enriched.map((candidate) => candidate.origin ?? "trusted-source"))];
  const overview = buildEditorialOverview(orderedForOverview, input);
  const brief: BriefResult = {
    taskName: input.name,
    coverageStart: coverage.start.toISOString(),
    coverageEnd: coverage.end.toISOString(),
    generatedAt: now.toISOString(),
    itemCount: enriched.length,
    importantFacts: partitioned.importantFacts,
    trendSignals: partitioned.trendSignals,
    otherItems: partitioned.otherItems,
    sourceList: enriched.flatMap((x) => (x.sourceUrls?.length ? x.sourceUrls : [x.sourceUrl]).map((url) => ({ source: x.source, url, publishedAt: x.publishedAt, sourceTier: x.sourceTier ?? "C", origin: x.origin ?? "trusted-source" }))),
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
      await generateBrief(task.user_id, task.id, normalizeTaskInput({ ...task, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: cfg, isActive: task.is_active }), now, scheduledSlot, { ...generation.credentials, provider: generation.credentials.provider });
      count++;
    } catch {
      // 额度或上游异常时暂停该任务，避免下一轮调度持续失败。
      await query("UPDATE intelligence_tasks SET is_active = false WHERE id = $1 AND user_id = $2", [task.id, task.user_id]);
    }
  }
  return count;
}
