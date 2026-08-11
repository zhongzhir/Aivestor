import { query } from "@/lib/db";
import { getGenerationAccess, reserveIntelligenceQuota } from "@/lib/intelligenceGeneration";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator, safeRetrievalMetadata, type IntelligenceProvider } from "@/lib/intelligenceProvider";
import { emptyRelevanceDropReasons, isHistoricalReviewCandidate, normalizeIntelligenceTaskSemantics, topicRelevance, type RelevanceDropReasons, type RelevancePhase } from "@/lib/intelligenceTopicRelevance";
import { acquireEvidence, type EvidenceStatus } from "@/lib/intelligenceEvidence";
import { runAiFirstResearch, type AgenticResearchTelemetry, type ResearchAgenda, type ResearchClaim, type VerificationTrace } from "@/lib/intelligenceResearchAgent";
import { runAiNativeResearch, type AiNativeResearchReport, type AiNativeResearchResult } from "@/lib/intelligenceAiNative";
import { normalizePublicTimestamp } from "@/lib/intelligenceTime";
import {
  buildEditorialOverview,
  enrichCandidate,
  isClueQualityEligible,
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
  sourceList: Array<{ source: string; url: string | null; publishedAt: string | null; sourceTier?: "S" | "A" | "B" | "C" | "D"; origin?: string }>;
  metadata: {
    overview: string;
    origins: string[];
    generationProvider: string;
    generationModel: string | null;
    retrieval: ReturnType<typeof safeRetrievalMetadata> & {
      preEvidencePassed?: number;
      postEvidencePassed?: number;
      relevanceDropReasons?: Record<string, number>;
    };
    research?: {
      mode: "ai-native";
      executionMode: "ai-native";
      report: AiNativeResearchReport;
      agent: AgenticResearchTelemetry;
    } | {
      mode: "ai-first";
      plan: { understanding: string; eventTypes: string[]; likelyEntities: string[]; queries: string[]; deepDiveCriteria: string[] };
      rounds: Array<{ round: number; stage?: "discovery" | "gap-fill" | "verification"; queries: string[]; resultCount: number; followUpQueries: string[] }>;
      claims: number;
      generationCalls: number;
      verifiedClaims: ResearchClaim[];
      discardedClaims: Array<{ claim: ResearchClaim; reason: string }>;
      supervisorAgendas: ResearchAgenda[];
      verificationTraces: VerificationTrace[];
      retrievalProviderGap: boolean;
      executionMode?: "agentic" | "legacy-fallback";
      agent?: AgenticResearchTelemetry;
    };
  };
}

export function buildAiNativeBriefResult(
  input: IntelligenceTaskInput,
  coverage: { start: Date; end: Date },
  now: Date,
  generationProvider: IntelligenceProvider,
  research: AiNativeResearchResult,
): BriefResult {
  return {
    taskName: input.name,
    coverageStart: coverage.start.toISOString(),
    coverageEnd: coverage.end.toISOString(),
    generatedAt: now.toISOString(),
    itemCount: research.importantFacts.length + research.otherItems.length,
    importantFacts: research.importantFacts,
    trendSignals: [],
    otherItems: research.otherItems,
    sourceList: research.sourceList,
    metadata: {
      // The AI-native answer is the user-facing result. Do not reclassify or rebuild it here.
      overview: research.report.answer,
      origins: ["web-search"],
      generationProvider: generationProvider.id,
      generationModel: generationProvider.model || null,
      retrieval: {
        status: research.retrieval.status,
        providers: research.retrieval.providers,
        searchCandidates: research.retrieval.searchCandidates,
        // Compatibility counters only: AI-native does no programmatic relevance filtering.
        relevancePassed: research.report.items.length,
        relevanceDropped: 0,
        evidence: research.retrieval.evidence,
        final: research.retrieval.final,
      },
      research: {
        mode: "ai-native",
        executionMode: "ai-native",
        report: research.report,
        agent: research.telemetry,
      },
    },
  };
}

/** @deprecated 使用 mergeEventCandidates；保留导出名兼容既有测试 */
export function mergeCandidates(candidates: Candidate[]): Candidate[] {
  return mergeEventCandidates(candidates);
}

export function buildRetrievalOverview(status: "success" | "partial" | "failed", items: Candidate[], input: IntelligenceTaskInput, editorialBackground: Candidate[] = []): string {
  return status === "failed" ? "本期联网检索未成功完成，请稍后重新生成。" : buildEditorialOverview(items, input, editorialBackground);
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

interface FilterResult {
  candidates: Candidate[];
  dropReasons: RelevanceDropReasons;
}

function incrementDropReason(reasons: RelevanceDropReasons, reason?: string) {
  if (reason === "region-mismatch") reasons.regionMismatch++;
  else if (reason === "topic-mismatch") reasons.topicMismatch++;
  else if (reason === "capital-event-mismatch") reasons.capitalEventMismatch++;
  else if (reason === "historical-review") reasons.historicalReview++;
  else if (reason === "product-only") reasons.productOnly++;
}

export function filterCandidatesWithReasons(candidates: Candidate[], input: IntelligenceTaskInput, start: Date, end: Date, phase: RelevancePhase = "post-evidence", deduplicate = phase === "post-evidence"): FilterResult {
  const topics = input.topics;
  const regions = input.regions;
  const entities = input.entities;
  const soft = [...input.keywords, ...input.includeRequirements];
  const exclude = input.excludeRequirements;
  const reasons = emptyRelevanceDropReasons();
  const result = candidates.filter((candidate) => {
    if (!candidate.timeUnconfirmed) {
      const publishedAt = new Date(candidate.publishedAt);
      if (!Number.isFinite(publishedAt.getTime()) || publishedAt < start || publishedAt > end) return false;
    }
    const text = [candidate.title, candidate.content, candidate.subject, candidate.region ?? ""].join(" ");
    if (exclude.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false;
    if (candidate.origin === "web-search") {
      const relevance = topicRelevance(candidate, input, phase);
      if (!relevance.passed) {
        incrementDropReason(reasons, relevance.reason);
        return false;
      }
      if (isHistoricalReviewCandidate(candidate, input)) {
        incrementDropReason(reasons, "historical-review");
        return false;
      }
    }
    // 预取证阶段不以主题/地域字面缺失硬拒绝；正文取证后再执行严格主题门。
    if (phase === "post-evidence" && topics.length && !textMatches(text, topics) && candidate.origin !== "web-search") return false;
    if (phase === "post-evidence" && regions.length && !textMatches(text, regions) && candidate.origin !== "web-search") return false;
    if (!topics.length && !regions.length && phase === "post-evidence") {
      const include = [...entities, ...soft];
      if (!textMatches(text, include)) return false;
    } else if (entities.length && soft.length) {
      // 已通过主题/地域；实体为加分项，不强制
    } else if (phase === "post-evidence" && !topics.length && regions.length && soft.length && !textMatches(text, soft) && !textMatches(text, entities)) {
      return false;
    }
    return true;
  });

  if (!deduplicate) return { candidates: result, dropReasons: reasons };
  const bySubject = new Map<string, Candidate>();
  for (const candidate of result) {
    const key = candidate.subject.trim().toLocaleLowerCase() || candidate.title.trim().toLocaleLowerCase();
    const previous = bySubject.get(key);
    if (!previous || new Date(candidate.publishedAt) > new Date(previous.publishedAt)) bySubject.set(key, candidate);
  }
  return { candidates: [...bySubject.values()].sort((a, b) => {
    const rank = { fact: 3, trend: 2, other: 1 };
    return rank[b.kind] - rank[a.kind] || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  }).slice(0, Math.max(1, Math.min(50, input.maxItems * 3))), dropReasons: reasons };
}

export function filterCandidates(candidates: Candidate[], input: IntelligenceTaskInput, start: Date, end: Date): Candidate[] {
  return filterCandidatesWithReasons(candidates, input, start, end).candidates;
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
  return normalizeIntelligenceTaskSemantics({
    name: typeof body.name === "string" ? body.name.trim() : "",
    topics: asList(body.topics), entities: asList(body.entities), keywords: asList(body.keywords), regions: asList(body.regions),
    includeRequirements: asList(body.includeRequirements), excludeRequirements: asList(body.excludeRequirements),
    maxItems: Math.max(1, Math.min(50, Number(body.maxItems) || 10)),
    lookbackPeriod: { kind: lookback.kind === "custom" ? "custom" : "days", value: Number(lookback.value) || 3, start: typeof lookback.start === "string" ? lookback.start : undefined, end: typeof lookback.end === "string" ? lookback.end : undefined },
    outputInstructions: typeof body.outputInstructions === "string" ? body.outputInstructions.trim() : "",
    executionMode: mode, scheduleConfig, isActive: body.isActive === true,
  });
}

export function coverageFor(input: IntelligenceTaskInput, now = new Date()): { start: Date; end: Date } {
  if (input.lookbackPeriod.kind === "custom" && input.lookbackPeriod.start && input.lookbackPeriod.end) return { start: new Date(input.lookbackPeriod.start), end: new Date(input.lookbackPeriod.end) };
  const days = Math.max(1, Math.min(365, input.lookbackPeriod.value || 3));
  return { start: new Date(now.getTime() - days * 86400000), end: now };
}

function coveragePlaceholder(value?: string | null): string {
  return normalizePublicTimestamp(value) || "";
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

async function persistBrief(userId: string, taskId: string, brief: BriefResult, scheduledSlot?: string): Promise<{ id: string; brief: BriefResult }> {
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

/**
 * Produces a complete research brief without changing business data.
 *
 * This is the shared production generation path: interactive/scheduled brief
 * creation persists its result through generateBrief, while read-only quality
 * validation can exercise exactly the same retrieval, investor-context and
 * model-generation flow without creating an intelligence_briefs record.
 */
export async function generateResearchBrief(userId: string, input: IntelligenceTaskInput, now = new Date(), credentials?: Parameters<typeof createIntelligenceGenerationProvider>[0]): Promise<BriefResult> {
  if (!input.isActive) throw new Error("停用的情报任务不能执行");
  const validationError = validateTaskInput(input, now);
  if (validationError) throw new Error(validationError);
  const normalizedInput = normalizeIntelligenceTaskSemantics(input);
  const coverage = coverageFor(normalizedInput, now);
  const baseProvider: IntelligenceProvider = createIntelligenceGenerationProvider(credentials);
  const investorContext = await import("@/lib/intelligenceInvestorContext")
    .then(({ buildInvestorResearchContext }) => buildInvestorResearchContext(userId, `${input.name}\n${input.outputInstructions}\n${[...input.topics, ...input.entities, ...input.keywords].join(" ")}`))
    .catch(() => "");
  const generationProvider: IntelligenceProvider = investorContext && baseProvider.generate
    ? { ...baseProvider, generate: ({ system, prompt }) => baseProvider.generate!({ system: `${system}\n\n## 投资人相关性上下文\n${investorContext}`, prompt }) }
    : baseProvider;
  const retrieval = new IntelligenceRetrievalOrchestrator([generationProvider]);
  if (generationProvider.capabilities.agenticToolUse && generationProvider.runAgentTurn && generationProvider.generate) {
    const research = await runAiNativeResearch(normalizedInput, coverage, { generationProvider, retrieval });
    return buildAiNativeBriefResult(input, coverage, now, generationProvider, research);
  }
  if (generationProvider.generate) {
    const research = await runAiFirstResearch(normalizedInput, coverage, { generationProvider, retrieval });
    const brief: BriefResult = {
      taskName: input.name,
      coverageStart: coverage.start.toISOString(),
      coverageEnd: coverage.end.toISOString(),
      generatedAt: now.toISOString(),
      itemCount: research.importantFacts.length + research.otherItems.length,
      importantFacts: research.importantFacts,
      trendSignals: research.trendSignals,
      otherItems: research.otherItems,
      sourceList: research.sourceList,
      metadata: {
        overview: research.overview,
        origins: ["web-search"],
        generationProvider: generationProvider.id,
        generationModel: generationProvider.model || null,
        retrieval: {
          status: research.retrieval.status,
          providers: research.retrieval.providers,
          searchCandidates: research.retrieval.searchCandidates,
          relevancePassed: research.research.claims,
          relevanceDropped: Math.max(0, research.retrieval.searchCandidates - research.research.claims),
          evidence: research.retrieval.evidence,
          final: research.retrieval.final,
        },
        research: { mode: "ai-first", ...research.research },
      },
    };
    return brief;
  }
  const retrievalResult = await retrieval.retrieve({ input: normalizedInput, start: coverage.start });
  const webCandidates: Candidate[] = retrievalResult.results.map((item) => {
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
  const preFiltered = filterCandidatesWithReasons([...webCandidates, ...(retrievalResult.status === "failed" ? [] : await loadCandidates(coverage.start, coverage.end))], normalizedInput, coverage.start, coverage.end, "pre-evidence", false);
  // 先按现有候选评分截取高价值 URL，再做有限并发正文取证，避免每次任务抓取整个搜索结果集。
  const evidenceCandidates = scoreCandidates(preFiltered.candidates, normalizedInput).slice(0, 16);
  const evidenceResult = await acquireEvidence(evidenceCandidates);
  for (const candidate of evidenceCandidates) {
    const resolved = resolvePublishedAt({ sourcePublishedAt: candidate.evidencePublishedAt, url: candidate.sourceUrl });
    if (candidate.evidencePublishedAt) {
      candidate.publishedAt = resolved.publishedAt || candidate.publishedAt;
      candidate.timeUnconfirmed = resolved.timeUnconfirmed;
    }
    delete candidate.evidencePublishedAt;
  }
  const postFiltered = filterCandidatesWithReasons(preFiltered.candidates, normalizedInput, coverage.start, coverage.end, "post-evidence", true);
  const filtered = postFiltered.candidates;
  const dropReasons = {
    regionMismatch: preFiltered.dropReasons.regionMismatch + postFiltered.dropReasons.regionMismatch,
    topicMismatch: preFiltered.dropReasons.topicMismatch + postFiltered.dropReasons.topicMismatch,
    capitalEventMismatch: preFiltered.dropReasons.capitalEventMismatch + postFiltered.dropReasons.capitalEventMismatch,
    historicalReview: preFiltered.dropReasons.historicalReview + postFiltered.dropReasons.historicalReview,
    productOnly: preFiltered.dropReasons.productOnly + postFiltered.dropReasons.productOnly,
  };
  const preEvidencePassed = preFiltered.candidates.filter((candidate) => candidate.origin === "web-search").length;
  const postEvidencePassed = filtered.filter((candidate) => candidate.origin === "web-search").length;
  const merged = mergeEventCandidates(filtered);
  const enriched = scoreCandidates(
    merged.map((candidate) => enrichCandidate(candidate, normalizedInput)).filter(isClueQualityEligible),
    normalizedInput,
  ).slice(0, Math.max(1, Math.min(50, input.maxItems)));
  const partitioned = partitionBriefItems(enriched);
  const orderedForOverview = [...partitioned.importantFacts, ...partitioned.trendSignals, ...partitioned.otherItems];
  const concreteItems = [...partitioned.importantFacts, ...partitioned.otherItems];
  const origins = [...new Set([...concreteItems, ...partitioned.editorialBackground].map((candidate) => candidate.origin ?? "trusted-source"))];
  const overview = buildRetrievalOverview(retrievalResult.status, orderedForOverview, normalizedInput, partitioned.editorialBackground);
  const clues = partitioned.otherItems.filter((candidate) => candidate.isClue).length;
  const retrievalMetadata = safeRetrievalMetadata(retrievalResult, {
    searchCandidates: retrievalResult.results.length,
    relevancePassed: postEvidencePassed,
    relevanceDropped: Math.max(0, webCandidates.length - postEvidencePassed),
    evidence: { full: evidenceResult.stats.full, partial: evidenceResult.stats.partial, unavailable: evidenceResult.stats.unavailable },
    final: { facts: partitioned.importantFacts.length, clues, trends: partitioned.trendSignals.length },
    preEvidencePassed,
    postEvidencePassed,
    relevanceDropReasons: dropReasons,
  });
  const brief: BriefResult = {
    taskName: input.name,
    coverageStart: coverage.start.toISOString(),
    coverageEnd: coverage.end.toISOString(),
    generatedAt: now.toISOString(),
    itemCount: concreteItems.length,
    importantFacts: partitioned.importantFacts,
    trendSignals: partitioned.trendSignals,
    otherItems: partitioned.otherItems,
    sourceList: concreteItems.flatMap((x) => (x.sourceUrls?.length ? x.sourceUrls : [x.sourceUrl]).map((url) => ({ source: x.source, url, publishedAt: x.publishedAt, sourceTier: x.sourceTier ?? "C", origin: x.origin ?? "trusted-source" }))),
    metadata: { overview, origins, generationProvider: generationProvider.id, generationModel: generationProvider.model || null, retrieval: retrievalMetadata },
  };
  return brief;
}

export async function generateBrief(userId: string, taskId: string, input: IntelligenceTaskInput, now = new Date(), scheduledSlot?: string, credentials?: Parameters<typeof createIntelligenceGenerationProvider>[0]): Promise<{ id: string; brief: BriefResult }> {
  const brief = await generateResearchBrief(userId, input, now, credentials);
  return persistBrief(userId, taskId, brief, scheduledSlot);
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
