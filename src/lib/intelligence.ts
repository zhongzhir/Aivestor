import { query } from "@/lib/db";

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
  sourceList: Array<{ source: string; url: string | null; publishedAt: string }>;
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
  const rows = await query<{ id: string; title: string; content: string; generated_at: string; data_as_of: string }>(
    `SELECT id, title, content, generated_at, data_as_of::text AS data_as_of
       FROM market_insights
      WHERE generated_at BETWEEN $1 AND $2 OR data_as_of BETWEEN $1::date AND $2::date
      ORDER BY generated_at DESC`, [start.toISOString(), end.toISOString()]
  );
  return rows.map((row) => ({ id: row.id, title: row.title, content: row.content, source: "market-insights / 中鉴同步数据", sourceUrl: null, publishedAt: row.generated_at || `${row.data_as_of}T00:00:00.000Z`, subject: row.title, region: null, kind: /趋势|增长|变化|融资|政策/.test(`${row.title}${row.content}`) ? "trend" : "fact" }));
}

export async function generateBrief(userId: string, taskId: string, input: IntelligenceTaskInput, now = new Date()): Promise<{ id: string; brief: BriefResult }> {
  if (!input.isActive) throw new Error("停用的情报任务不能执行");
  const coverage = coverageFor(input, now);
  const candidates = filterCandidates(await loadCandidates(coverage.start, coverage.end), input, coverage.start, coverage.end);
  const brief: BriefResult = {
    taskName: input.name, coverageStart: coverage.start.toISOString(), coverageEnd: coverage.end.toISOString(), generatedAt: now.toISOString(), itemCount: candidates.length,
    importantFacts: candidates.filter((x) => x.kind === "fact"), trendSignals: candidates.filter((x) => x.kind === "trend"), otherItems: candidates.filter((x) => x.kind === "other"),
    sourceList: candidates.map((x) => ({ source: x.source, url: x.sourceUrl, publishedAt: x.publishedAt })),
  };
  const rows = await query<{ id: string }>(
    `INSERT INTO intelligence_briefs (task_id, user_id, task_name, coverage_start, coverage_end, generated_at, item_count, important_facts, trend_signals, other_items, source_list)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb) RETURNING id`,
    [taskId, userId, brief.taskName, brief.coverageStart, brief.coverageEnd, brief.generatedAt, brief.itemCount, JSON.stringify(brief.importantFacts), JSON.stringify(brief.trendSignals), JSON.stringify(brief.otherItems), JSON.stringify(brief.sourceList)]
  );
  return { id: rows[0].id, brief };
}

export async function runScheduledTasks(now = new Date()): Promise<number> {
  const tasks = await query<{ id: string; user_id: string; name: string; topics: unknown; entities: unknown; keywords: unknown; regions: unknown; include_requirements: unknown; exclude_requirements: unknown; max_items: number; lookback_period: unknown; output_instructions: string; execution_mode: ExecutionMode; schedule_config: ScheduleConfig; is_active: boolean }>(
    `SELECT * FROM intelligence_tasks WHERE is_active = true AND execution_mode = 'scheduled'`
  );
  let count = 0;
  for (const task of tasks) {
    const cfg = task.schedule_config;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? -1);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    if (cfg.time !== `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` || (cfg.frequency === "weekly" && !(cfg.weekdays ?? []).includes(weekday))) continue;
    const recent = await query<{ id: string }>(
      `SELECT id FROM intelligence_briefs WHERE task_id = $1 AND generated_at > $2::timestamptz - ($3 || ' days')::interval LIMIT 1`,
      [task.id, now.toISOString(), cfg.frequency === "weekly" ? 6 : 0.9]
    );
    if (recent[0]) continue;
    await generateBrief(task.user_id, task.id, normalizeTaskInput({ ...task, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, outputInstructions: task.output_instructions, executionMode: task.execution_mode, scheduleConfig: cfg, isActive: task.is_active }), now);
    count++;
  }
  return count;
}
