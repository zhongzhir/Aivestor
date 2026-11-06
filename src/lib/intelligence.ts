import { query } from "@/lib/db";
import { createDefaultIntelligenceRetrievalProviders, createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator, safeRetrievalMetadata, type IntelligenceGenerationProviderOptions, type IntelligenceProvider, type RetrievalProviderDiagnostic } from "@/lib/intelligenceProvider";
import { emptyRelevanceDropReasons, isHistoricalReviewCandidate, normalizeIntelligenceTaskSemantics, topicRelevance, type RelevanceDropReasons, type RelevancePhase } from "@/lib/intelligenceTopicRelevance";
import { acquireEvidence, type EvidenceAcquirer, type EvidenceStatus } from "@/lib/intelligenceEvidence";
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
import { loadIntelligencePersonalization, type IntelligencePersonalization } from "@/lib/intelligencePersonalization";
import { safeIntelligenceExternalUrl } from "@/lib/intelligenceUrl";
import { createDeepSeekEvidenceAcquirer, createDeepSeekSearchFetchAdapter, DeepSeekSearchFetchBudget, isOfficialDeepSeekBaseUrl, type DeepSeekBudgetSnapshot, type DeepSeekDurableAttemptLedger, type DeepSeekFetchMode } from "@/lib/intelligenceDeepSeekAdapter";
import type { DeepSeekGenerationDurableLedger } from "@/lib/intelligenceDeepSeekGenerationBudget";
import { runIntelligencePipeline, type IntelligencePipelineStore } from "@/lib/intelligencePipeline";

export type ExecutionMode = "manual" | "scheduled";
export type Feedback = "valuable" | "irrelevant";

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function configuredDeepSeekFetchMode(value: string | undefined): DeepSeekFetchMode {
  return value === "fallback" || value === "prefer" ? value : "off";
}

type IntelligenceGenerationCredentials = Parameters<typeof createIntelligenceGenerationProvider>[0];

export interface DeepSeekSearchFetchAudit {
  provider: "deepseek-web";
  credentialSource: "byok" | "platform" | "unavailable";
  featureEnabled: boolean;
  singleRunSearchAuthorized: boolean;
  singleRunFetchAuthorized: boolean;
  enabled: boolean;
  fetchMode: DeepSeekFetchMode;
  blockReason?: "feature_disabled" | "provider_not_selected" | "platform_billing_disabled" | "single_run_not_authorized" | "missing_credentials" | "non_official_endpoint";
  usage: DeepSeekBudgetSnapshot;
}

export interface IntelligenceResearchInfrastructureOptions {
  authorizeDeepSeekSearchByok?: boolean;
  authorizeDeepSeekFetchByok?: boolean;
  deepSeekDurableAttemptLedger?: DeepSeekDurableAttemptLedger;
  deepSeekGenerationDurableLedger?: DeepSeekGenerationDurableLedger;
  requireDeepSeekGenerationBudget?: boolean;
  /** 受控真实验收只构造 DeepSeek 检索，防止百炼/Tavily 绕过该 run 的美元账本。 */
  retrievalProviderMode?: "default" | "deepseek-only";
  /** 仅用于离线 transport 测试；生产不传时使用全局 fetch。 */
  deepSeekFetchImpl?: typeof fetch;
  /** 仅用于离线 worker 验证；生产不传时使用真实 SDK transport。 */
  generationStreamChatImpl?: IntelligenceGenerationProviderOptions["streamChatImpl"];
  /** 仅用于离线 worker 验证；生产不传时使用真实 SDK transport。 */
  generationToolChatImpl?: IntelligenceGenerationProviderOptions["completeChatWithToolsImpl"];
  /** 仅用于 NODE_ENV=test 的完整 worker 取证链验证。 */
  testEvidenceAcquirer?: EvidenceAcquirer;
}

export interface IntelligenceExecutionOptions extends IntelligenceResearchInfrastructureOptions {
  onDeepSeekSearchFetchAudit?: (audit: DeepSeekSearchFetchAudit) => void | Promise<void>;
  /** Present only for claimed worker runs. Enables the recoverable deterministic pipeline. */
  pipelineStore?: IntelligencePipelineStore;
  /**
   * Wall-clock time at which this brief is produced. Coverage calculation still uses
   * the explicit `now` argument so a historic/custom window remains deterministic.
   */
  briefGeneratedAt?: Date;
}

const emptyDeepSeekUsage = (): DeepSeekBudgetSnapshot => ({
  searchAttempts: 0,
  fetchAttempts: 0,
  searchReserved: 0,
  searchCompleted: 0,
  searchFailed: 0,
  searchUncertain: 0,
  fetchReserved: 0,
  fetchCompleted: 0,
  fetchFailed: 0,
  fetchUncertain: 0,
  billableSearch: 0,
  billableFetch: 0,
  uncertain: 0,
  reservedUsdMicros: 0,
  estimatedBillableUsdMicros: 0,
});

export function createIntelligenceResearchInfrastructure(
  credentials?: IntelligenceGenerationCredentials,
  env: Record<string, string | undefined> = process.env,
  options: IntelligenceResearchInfrastructureOptions = {},
) {
  if (options.testEvidenceAcquirer && env.NODE_ENV !== "test") {
    throw new Error("INTELLIGENCE_TEST_EVIDENCE_ACQUIRER_REQUIRES_TEST_ENV");
  }
  const generationProvider: IntelligenceProvider = createIntelligenceGenerationProvider(credentials, {
    deepSeekGenerationLedger: options.deepSeekGenerationDurableLedger,
    requireDeepSeekBudget: options.requireDeepSeekGenerationBudget === true,
    streamChatImpl: options.generationStreamChatImpl,
    completeChatWithToolsImpl: options.generationToolChatImpl,
  });
  const independentProviders = options.retrievalProviderMode === "deepseek-only"
    ? []
    : createDefaultIntelligenceRetrievalProviders();
  let deepSeekEvidenceAcquirer: import("@/lib/intelligenceEvidence").EvidenceAcquirer | undefined;
  let deepSeekAdapter: ReturnType<typeof createDeepSeekSearchFetchAdapter> | undefined;
  const selectedProvider = credentials?.selectedProvider || credentials?.provider;
  const featureEnabled = env.INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED === "true";
  const credentialSource: DeepSeekSearchFetchAudit["credentialSource"] = !credentials
    ? "unavailable"
    : credentials.usingFreeQuota === false ? "byok" : "platform";
  const searchAuthorized = options.authorizeDeepSeekSearchByok === true;
  const fetchAuthorized = options.authorizeDeepSeekFetchByok === true;
  const blockReason: DeepSeekSearchFetchAudit["blockReason"] = !featureEnabled ? "feature_disabled"
    : selectedProvider !== "deepseek" ? "provider_not_selected"
      : credentialSource === "platform" ? "platform_billing_disabled"
        : !searchAuthorized ? "single_run_not_authorized"
          : !credentials?.apiKey ? "missing_credentials"
            : !isOfficialDeepSeekBaseUrl(credentials.baseURL) ? "non_official_endpoint"
              : undefined;
  if (!blockReason) {
    const searchLimit = positiveInteger(env.INTELLIGENCE_DEEPSEEK_SEARCH_MAX_REQUESTS, 2, 2);
    // 首次端到端验收不允许 Fetch；远端 DNS/重定向边界另行验证后再开放。
    const fetchLimit = 0;
    const budget = new DeepSeekSearchFetchBudget(searchLimit, fetchLimit);
    deepSeekAdapter = createDeepSeekSearchFetchAdapter({
      apiKey: credentials!.apiKey,
      baseURL: credentials!.baseURL,
      budget,
      durableAttemptLedger: options.deepSeekDurableAttemptLedger,
      fetchImpl: options.deepSeekFetchImpl,
      maxAttempts: 1,
    });
    independentProviders.push(deepSeekAdapter);
    const fetchMode = fetchAuthorized ? configuredDeepSeekFetchMode(env.INTELLIGENCE_DEEPSEEK_FETCH_MODE) : "off";
    if (fetchMode !== "off") deepSeekEvidenceAcquirer = createDeepSeekEvidenceAcquirer(deepSeekAdapter, { mode: fetchMode });
  }
  const deepSeekAudit = (): DeepSeekSearchFetchAudit => ({
    provider: "deepseek-web",
    credentialSource,
    featureEnabled,
    singleRunSearchAuthorized: searchAuthorized,
    singleRunFetchAuthorized: fetchAuthorized,
    enabled: !!deepSeekAdapter,
    fetchMode: deepSeekAdapter && fetchAuthorized ? configuredDeepSeekFetchMode(env.INTELLIGENCE_DEEPSEEK_FETCH_MODE) : "off",
    ...(blockReason ? { blockReason } : {}),
    usage: deepSeekAdapter?.usageSnapshot() ?? emptyDeepSeekUsage(),
  });
  const evidenceAcquirer = options.testEvidenceAcquirer ?? deepSeekEvidenceAcquirer;
  return {
    generationProvider,
    retrieval: new IntelligenceRetrievalOrchestrator([generationProvider], independentProviders),
    deepSeekAudit,
    ...(evidenceAcquirer ? { acquireEvidence: evidenceAcquirer } : {}),
    ...(deepSeekAdapter ? { deepSeekAdapter } : {}),
  };
}

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
  /** User-authored request retained in the owner-scoped task/run snapshot. */
  originalRequest?: string;
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
  /** 用户明确要求的事件类别；研究计划与检索 query 必须消费。 */
  eventTypes?: string[];
  /** 预留的来源策略元数据；首版本不宣称可控制供应商覆盖。 */
  sourcePolicy?: Record<string, unknown>;
  /** 运行时注入，不落入任务配置；用于研究阶段的个人关联上下文。 */
  personalizationPrompt?: string;
  personalizationMeta?: Pick<IntelligencePersonalization, "profileUsed" | "projectIds" | "judgmentCount">;
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
  relevanceReason?: string;
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
  /** 文章来源日期的取值来源；事件日/抓取日/生成日不参与。 */
  publishedAtSource?: "evidence" | "provider" | "url" | "unknown";
  publishedAtConfidence?: "high" | "medium" | "low" | "unknown";
  /** 面向股权投资的事件类别；旧简报可为空。 */
  eventType?: string;
  /** 事件实际发生日，与文章来源发布时间分离。 */
  eventDate?: string;
  /** 正文只支持月份、季度、节日前后等模糊事件时间时保留原始表述。 */
  eventTimeText?: string;
  /** 仅在正文中的日期与事件动作共同支持时标记。 */
  eventDateSupport?: "evidence";
  discoveredAt?: string;
  fetchedAt?: string;
  supportLevel?: "direct" | "corroborating" | "context" | "unknown";
  exclusionReason?: string;
  conflicts?: Array<{
    type: "financing-round";
    reason: "same-entity-near-date-different-round";
    entity: string;
    values: string[];
    relatedSourceUrls: string[];
  }>;
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
  sourceList: Array<{ source: string; url: string | null; publishedAt: string | null; publishedAtSource?: Candidate["publishedAtSource"]; publishedAtConfidence?: Candidate["publishedAtConfidence"]; sourceTier?: "S" | "A" | "B" | "C" | "D"; origin?: string }>;
  metadata: {
    overview: string;
    origins: string[];
    generationProvider: string;
    generationModel: string | null;
    personalization?: Pick<IntelligencePersonalization, "profileUsed" | "projectIds" | "judgmentCount">;
    retrieval: ReturnType<typeof safeRetrievalMetadata> & {
      preEvidencePassed?: number;
      postEvidencePassed?: number;
      relevanceDropReasons?: Record<string, number>;
      coverageConclusion?: "verified_no_matching_items" | "items_found" | "insufficient_evidence";
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
    } | {
      mode: "pipeline-v2";
      pipelineVersion: number;
      stages: string[];
      unresolvedGaps: string[];
      windowFilter?: {
        inside: number;
        unknownDate: number;
        outside: number;
        outsideEventFacts?: number;
      };
      confidence?: "high" | "medium" | "low";
      evidenceFallbackClues?: number;
      validation?: {
        parserVersion: number;
        totalItems: number;
        acceptedItems: number;
        rejectedItems: number;
        rejectionReasons: Record<string, number>;
        sanitizedFields: Record<string, number>;
      };
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
  const importantFacts = coverageSafeItems(research.retrieval.status, research.importantFacts);
  const otherItems = coverageSafeItems(research.retrieval.status, research.otherItems);
  const itemCount = importantFacts.length + otherItems.length;
  const overview = userFacingRetrievalOverview(research.retrieval.status, itemCount > 0, research.report.answer);
  return {
    taskName: input.name,
    coverageStart: coverage.start.toISOString(),
    coverageEnd: coverage.end.toISOString(),
    generatedAt: now.toISOString(),
    itemCount,
    importantFacts,
    trendSignals: [],
    otherItems,
    sourceList: research.sourceList,
    metadata: {
      overview,
      origins: ["web-search"],
      generationProvider: generationProvider.id,
      generationModel: generationProvider.model || null,
      personalization: input.personalizationMeta,
      retrieval: {
        status: research.retrieval.status,
        providers: research.retrieval.providers,
        searchCandidates: research.retrieval.searchCandidates,
        // Compatibility counters only: AI-native does no programmatic relevance filtering.
        relevancePassed: research.report.items.length,
        relevanceDropped: 0,
        evidence: research.retrieval.evidence,
        final: research.retrieval.final,
        sources: research.retrieval.sources,
        coverageConclusion: retrievalCoverageConclusion(research.retrieval.status, itemCount, research.retrieval.providers),
      },
      research: {
        mode: "ai-native",
        executionMode: "ai-native",
        // report.answer is also returned by the API and persisted. Keep it in
        // sync with the safe overview so partial/failed retrieval cannot leak a
        // model-authored "nothing exists" conclusion through a secondary path.
        report: { ...research.report, answer: overview },
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
  return userFacingRetrievalOverview(status, items.length > 0, buildEditorialOverview(items, input, editorialBackground));
}

function userFacingRetrievalOverview(status: "success" | "partial" | "failed", hasItems: boolean, completedOverview: string): string {
  if (status === "failed") return "本次检索未完成，不能据此判断该时间范围内没有相关事件。请查看失败原因后重试。";
  if (status === "partial") {
    const coverageSafeOverview = removeCoverageLimitedAbsenceClaims(completedOverview);
    return hasItems
      ? `本次仅完成部分来源检索；以下内容只反映已成功来源，不能视为完整覆盖。${coverageSafeOverview || "已成功来源形成的事项见下方。"}官方来源、公告及后续事件尚未检索充分，不能据此判断不存在。`
      : "本次仅完成部分来源检索，未形成可核验事项；这不代表该时间范围内不存在相关事件。请查看未完成来源或预算原因后补跑。";
  }
  return hasItems ? completedOverview : "在本次已成功完成的来源范围内，未发现符合条件且可核验的新增事项。";
}

function retrievalCoverageConclusion(
  status: "success" | "partial" | "failed",
  itemCount: number,
  providers: RetrievalProviderDiagnostic[],
): "verified_no_matching_items" | "items_found" | "insufficient_evidence" {
  if (itemCount > 0) return "items_found";
  const verifiedComplete = status === "success"
    && providers.length > 0
    && providers.every((provider) => provider.status === "success" && provider.coverageComplete === true);
  return verifiedComplete ? "verified_no_matching_items" : "insufficient_evidence";
}

export function removeCoverageLimitedAbsenceClaims(value: string): string {
  const chineseTarget = "(?:公司?官网|官方网站?|官方(?:公告|披露|来源|渠道|记录)?|权威(?:来源|渠道)?|公告|披露|工商(?:变更|记录)?|监管(?:文件|披露)?|原始来源|一手来源)";
  const englishTarget = "(?:official(?: company)? (?:website|announcement|disclosure|source|record|filing)|company website|regulatory filing|registry record|primary source|authoritative source)";
  const chineseAfterNegative = new RegExp(`[，,\\s]*(?:但|不过|然而|同时|且|亦)?\\s*(?:(?:目前|当前|现阶段|迄今)(?:仍|尚)?\\s*)?(?:截至[^，,。！？；\\n]{0,24}[，,\\s]*)?(?:尚未|未能|未曾|没有|未找到|未发现|无)[^，,。！？；\\n]{0,120}${chineseTarget}[^，,。！？；\\n]*`, "giu");
  const chineseBeforeNegative = new RegExp(`[，,\\s]*(?:但|不过|然而|同时|且|亦)?\\s*${chineseTarget}[^，,。！？；\\n]{0,80}(?:尚未|未能|未曾|没有|未找到|未发现|不存在|缺失)[^，,。！？；\\n]*`, "giu");
  const englishAfterNegative = new RegExp(`[,;]?\\s*(?:but|however|yet|and)?\\s*[,;]?\\s*(?:(?:currently|to\\s+date|so\\s+far)\\s+)?(?:we\\s+)?(?:did\\s+not|could\\s+not|have\\s+not|has\\s+not|no|found\\s+no|without)[^,.?!;]{0,120}${englishTarget}[^,.?!;]*`, "giu");
  const englishBeforeNegative = new RegExp(`[,;]?\\s*(?:but|however|yet|and)?\\s*[,;]?\\s*${englishTarget}[^,.?!;]{0,80}(?:was\\s+not|were\\s+not|could\\s+not\\s+be|has\\s+not\\s+been|is\\s+missing|was\\s+unavailable)[^,.?!;]*`, "giu");
  return value
    .replace(chineseAfterNegative, "")
    .replace(chineseBeforeNegative, "")
    .replace(englishAfterNegative, "")
    .replace(englishBeforeNegative, "")
    .replace(/(^|[。！？.!?])\s*尽管/gu, "$1")
    .replace(/(^|[。！？.!?])\s*[，,]\s*(?:且|但|同时|另外|另|而|不过|然而|并且)\s*/gu, "$1")
    .replace(/(^|[.!?])\s*[,;]?\s*(?:but|however|yet|and|while)\s*[,;]?\s*(?=[.!?])/giu, "$1")
    .replace(/(^|[.!?])\s*[,;]\s*(?:but|however|yet|and|while)\s*[,;]?\s*/giu, "$1")
    .replace(/[，,]\s*(?:但|不过|然而|同时|且|亦)?\s*(?:目前|当前|现阶段|迄今)?\s*(?=[。！？.!?])/gu, "")
    .replace(/[，,；;]\s*([。！？.!?])/gu, "$1")
    .replace(/([。！？.!?]){2,}/gu, "$1")
    .replace(/([\u3400-\u9fff])\.(?=\s|$)/gu, "$1。")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function coverageSafeItems<T extends Candidate>(status: "success" | "partial" | "failed", items: T[]): T[] {
  if (status === "success") return items;
  const safe = (value: string | undefined) => value === undefined ? undefined : removeCoverageLimitedAbsenceClaims(value);
  return items.map((item) => ({
    ...item,
    title: safe(item.title) || "相关事件（来源覆盖待补充）",
    content: safe(item.content) || "",
    summary: safe(item.summary),
    investmentNote: safe(item.investmentNote),
    relevanceReason: safe(item.relevanceReason),
    followUpReason: safe(item.followUpReason),
  }));
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
    weekdays: Array.isArray(schedule?.weekdays) ? schedule!.weekdays.filter((v): v is number => typeof v === "number") : schedule?.frequency === "weekly" ? [5] : undefined,
    time: typeof schedule?.time === "string" ? schedule.time : "08:00",
    timezone: typeof schedule?.timezone === "string" ? schedule.timezone : "Asia/Shanghai",
  } as ScheduleConfig : null;
  const lookback = body.lookbackPeriod && typeof body.lookbackPeriod === "object" ? body.lookbackPeriod as Record<string, unknown> : { kind: "days", value: 3 };
  return normalizeIntelligenceTaskSemantics({
    name: typeof body.name === "string" ? body.name.trim() : "",
    originalRequest: typeof body.originalRequest === "string" ? body.originalRequest.trim().slice(0, 4_000) : undefined,
    topics: asList(body.topics), entities: asList(body.entities), keywords: asList(body.keywords), regions: asList(body.regions),
    includeRequirements: asList(body.includeRequirements), excludeRequirements: asList(body.excludeRequirements),
    maxItems: Math.max(1, Math.min(50, Number(body.maxItems) || 10)),
    lookbackPeriod: { kind: lookback.kind === "custom" ? "custom" : "days", value: Number(lookback.value) || 3, start: typeof lookback.start === "string" ? lookback.start : undefined, end: typeof lookback.end === "string" ? lookback.end : undefined },
    outputInstructions: typeof body.outputInstructions === "string" ? body.outputInstructions.trim() : "",
    executionMode: mode, scheduleConfig, isActive: body.isActive === true,
    eventTypes: asList(body.eventTypes),
    sourcePolicy: body.sourcePolicy && typeof body.sourcePolicy === "object" && !Array.isArray(body.sourcePolicy) ? body.sourcePolicy as Record<string, unknown> : {},
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

export function sanitizeIntelligenceBrief(brief: BriefResult): BriefResult {
  const retrieval = brief.metadata.retrieval as { status?: "success" | "partial" | "failed" } | undefined;
  const status = retrieval?.status || "success";
  const sanitizeItemUrls = (item: BriefItem): BriefItem => ({
    ...item,
    sourceUrl: safeIntelligenceExternalUrl(item.sourceUrl),
    sourceUrls: item.sourceUrls?.map(safeIntelligenceExternalUrl).filter((url): url is string => !!url),
  });
  return {
    ...brief,
    importantFacts: coverageSafeItems(status, brief.importantFacts).map(sanitizeItemUrls),
    trendSignals: coverageSafeItems(status, brief.trendSignals).map(sanitizeItemUrls),
    otherItems: coverageSafeItems(status, brief.otherItems).map(sanitizeItemUrls),
    sourceList: brief.sourceList.map((source) => ({ ...source, url: safeIntelligenceExternalUrl(source.url) })),
  };
}

export async function persistIntelligenceBrief(userId: string, taskId: string, brief: BriefResult, scheduledSlot?: string, runId?: string): Promise<{ id: string; brief: BriefResult }> {
  const storedBrief = sanitizeIntelligenceBrief(brief);
  const values = [taskId, userId, storedBrief.taskName, storedBrief.coverageStart, storedBrief.coverageEnd, storedBrief.generatedAt, storedBrief.itemCount, JSON.stringify(storedBrief.importantFacts), JSON.stringify(storedBrief.trendSignals), JSON.stringify(storedBrief.otherItems), JSON.stringify(storedBrief.sourceList), JSON.stringify(storedBrief.metadata), scheduledSlot ?? null, runId ?? null];
  const conflict = runId
    ? `ON CONFLICT (run_id) WHERE run_id IS NOT NULL DO UPDATE SET
         task_name=EXCLUDED.task_name,coverage_start=EXCLUDED.coverage_start,
         coverage_end=EXCLUDED.coverage_end,generated_at=EXCLUDED.generated_at,
         item_count=EXCLUDED.item_count,important_facts=EXCLUDED.important_facts,
         trend_signals=EXCLUDED.trend_signals,other_items=EXCLUDED.other_items,
         source_list=EXCLUDED.source_list,metadata=EXCLUDED.metadata,schema_version=EXCLUDED.schema_version`
    : "ON CONFLICT (task_id, scheduled_slot) WHERE scheduled_slot IS NOT NULL DO NOTHING";
  const rows = await query<{ id: string }>(
    `INSERT INTO intelligence_briefs (task_id, user_id, task_name, coverage_start, coverage_end, generated_at, item_count, important_facts, trend_signals, other_items, source_list, metadata, scheduled_slot, run_id, schema_version)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,2
       FROM intelligence_tasks
      WHERE id = $1 AND user_id = $2 AND is_active = true AND archived_at IS NULL
     ${conflict} RETURNING id`,
    values
  );
  if (!rows[0] && scheduledSlot) {
    const existing = await query<{ id: string }>("SELECT id FROM intelligence_briefs WHERE task_id = $1 AND scheduled_slot = $2", [taskId, scheduledSlot]);
    if (existing[0]) return { id: existing[0].id, brief };
  }
  if (!rows[0]) throw new Error("任务已停用或删除");
  return { id: rows[0].id, brief: storedBrief };
}

export async function generateBrief(userId: string, taskId: string, input: IntelligenceTaskInput, now = new Date(), scheduledSlot?: string, credentials?: IntelligenceGenerationCredentials, runId?: string, deferPersistence = false, execution: IntelligenceExecutionOptions = {}): Promise<{ id: string; brief: BriefResult }> {
  if (!input.isActive) throw new Error("停用的情报任务不能执行");
  const validationError = validateTaskInput(input, now);
  if (validationError) throw new Error(validationError);
  const normalizedInput = normalizeIntelligenceTaskSemantics(input);
  const coverage = coverageFor(normalizedInput, now);
  const personalization = await loadIntelligencePersonalization(userId, normalizedInput);
  const researchInput: IntelligenceTaskInput = {
    ...normalizedInput,
    personalizationPrompt: personalization.prompt,
    personalizationMeta: {
      profileUsed: personalization.profileUsed,
      projectIds: personalization.projectIds,
      judgmentCount: personalization.judgmentCount,
    },
  };
  const infrastructure = createIntelligenceResearchInfrastructure(credentials, process.env, execution);
  const { generationProvider, retrieval } = infrastructure;
  const complete = (brief: BriefResult) => deferPersistence
    ? Promise.resolve({ id: "", brief: sanitizeIntelligenceBrief(brief) })
    : persistIntelligenceBrief(userId, taskId, brief, scheduledSlot, runId);
  const execute = async (): Promise<{ id: string; brief: BriefResult }> => {
  if (execution.pipelineStore) {
    const brief = await runIntelligencePipeline(researchInput, coverage, execution.briefGeneratedAt ?? now, {
      generationProvider,
      retrieval,
      store: execution.pipelineStore,
      ...(infrastructure.acquireEvidence ? { acquireEvidence: infrastructure.acquireEvidence } : {}),
      maxSearchQueries: 2,
    });
    return complete(brief);
  }
  if (generationProvider.capabilities.agenticToolUse && generationProvider.runAgentTurn && generationProvider.generate) {
    const research = await runAiNativeResearch(researchInput, coverage, { generationProvider, retrieval, ...(infrastructure.acquireEvidence ? { acquireEvidence: infrastructure.acquireEvidence } : {}) });
    return complete(buildAiNativeBriefResult(researchInput, coverage, now, generationProvider, research));
  }
  if (generationProvider.generate) {
    const research = await runAiFirstResearch(researchInput, coverage, { generationProvider, retrieval, ...(infrastructure.acquireEvidence ? { acquireEvidence: infrastructure.acquireEvidence } : {}) });
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
        overview: userFacingRetrievalOverview(research.retrieval.status, research.importantFacts.length + research.otherItems.length > 0, research.overview),
        origins: ["web-search"],
        generationProvider: generationProvider.id,
        generationModel: generationProvider.model || null,
        personalization: researchInput.personalizationMeta,
        retrieval: {
          status: research.retrieval.status,
          providers: research.retrieval.providers,
          searchCandidates: research.retrieval.searchCandidates,
          relevancePassed: research.research.claims,
          relevanceDropped: Math.max(0, research.retrieval.searchCandidates - research.research.claims),
          evidence: research.retrieval.evidence,
          final: research.retrieval.final,
          coverageConclusion: retrievalCoverageConclusion(
            research.retrieval.status,
            research.importantFacts.length + research.otherItems.length,
            research.retrieval.providers,
          ),
        },
        research: { mode: "ai-first", ...research.research },
      },
    };
    return complete(brief);
  }
  const retrievalResult = await retrieval.retrieve({ input: normalizedInput, start: coverage.start, end: coverage.end });
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
    const resolved = resolvePublishedAt({ evidencePublishedAt: candidate.evidencePublishedAt, sourcePublishedAt: candidate.publishedAt, url: candidate.sourceUrl });
    if (candidate.evidencePublishedAt) {
      candidate.publishedAt = resolved.publishedAt || candidate.publishedAt;
      candidate.timeUnconfirmed = resolved.timeUnconfirmed;
      candidate.publishedAtSource = resolved.publishedAtSource;
      candidate.publishedAtConfidence = resolved.publishedAtConfidence;
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
    metadata: {
      overview,
      origins,
      generationProvider: generationProvider.id,
      generationModel: generationProvider.model || null,
      retrieval: {
        ...retrievalMetadata,
        coverageConclusion: retrievalCoverageConclusion(retrievalResult.status, concreteItems.length, retrievalResult.providers),
      },
    },
  };
  return complete(brief);
  };
  try {
    return await execute();
  } finally {
    await execution.onDeepSeekSearchFetchAudit?.(infrastructure.deepSeekAudit());
  }
}

export async function runScheduledTasks(now = new Date()): Promise<number> {
  // 兼容旧调用点：只入队，不再同步生成、扣费或因失败停用任务。
  const scheduler = await import("@/lib/intelligenceRuns");
  await scheduler.initializeScheduledTasks(now);
  return scheduler.enqueueDueIntelligenceRuns(now);
}
