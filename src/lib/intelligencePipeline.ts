import { createHash } from "node:crypto";
import type { BriefResult, Candidate, IntelligenceTaskInput } from "@/lib/intelligence";
import { acquireEvidence, type EvidenceAcquirer, type EvidenceCandidate, type EvidenceStatus } from "@/lib/intelligenceEvidence";
import { safeRetrievalMetadata, type IntelligenceProvider, type IntelligenceRetrievalOrchestrator, type RetrievalResult } from "@/lib/intelligenceProvider";
import { planIntelligenceQueries, type WebSearchItem } from "@/lib/intelligenceWebSearch";
import { safeIntelligenceExternalUrl } from "@/lib/intelligenceUrl";
import {
  extractEventEntity,
  extractExplicitCalendarDates,
  mergeEventCandidates,
  replaceUnsupportedEventDate,
  resolveEvidenceBackedEventTime,
  validateEvidenceBoundClaim,
  type EventTimeEvidenceContext,
} from "@/lib/intelligenceBriefQuality";

export type IntelligencePipelineStage = "understanding" | "retrieval" | "evidence" | "facts" | "brief";
export type IntelligencePipelineCheckpointStatus = "running" | "completed" | "partial" | "failed" | "uncertain";

export interface IntelligencePipelineCheckpoint {
  stage: IntelligencePipelineStage;
  status: IntelligencePipelineCheckpointStatus;
  attempt: number;
  payload: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

export interface IntelligencePipelineEvidence {
  itemKey: string;
  url: string;
  title: string;
  sourceName: string;
  sourceTier: "S" | "A" | "B" | "C";
  retrievalProvider: string | null;
  query: string;
  snippet: string;
  contentExcerpt: string;
  publishedAt: string | null;
  fetchedAt: string | null;
  evidenceStatus: EvidenceStatus | null;
  failureReason: string | null;
}

export interface IntelligencePipelineStore {
  loadCheckpoint(stage: IntelligencePipelineStage): Promise<IntelligencePipelineCheckpoint | null>;
  saveCheckpoint(checkpoint: Omit<IntelligencePipelineCheckpoint, "attempt"> & { attempt?: number }): Promise<void>;
  upsertEvidence(items: IntelligencePipelineEvidence[]): Promise<void>;
  listEvidence(): Promise<IntelligencePipelineEvidence[]>;
}

export interface IntelligencePipelineDependencies {
  generationProvider: IntelligenceProvider;
  retrieval: Pick<IntelligenceRetrievalOrchestrator, "retrieve">;
  store: IntelligencePipelineStore;
  acquireEvidence?: EvidenceAcquirer;
  maxSearchQueries?: number;
}

interface ExtractedFact {
  headline: string;
  summary: string;
  assessment: string;
  eventDate: string | null;
  /** Model-proposed date retained only for conservative window isolation. */
  proposedEventDate: string | null;
  eventTimeText: string | null;
  eventType: string;
  entities: string[];
  status: "confirmed" | "reported" | "context";
  relevance: "high" | "medium" | "low";
  relevanceReason: string;
  evidenceIds: string[];
  rejectedAttributeLabels?: string[];
}

type StructuredAttributeKind = "round" | "amount" | "percentage" | "party" | "role" | "valuation";

interface SupportedStructuredAttribute {
  kind: StructuredAttributeKind;
  value: string;
  entity: string | null;
  role: string | null;
  evidenceIds: string[];
}

interface FactBundle {
  overview: string;
  facts: ExtractedFact[];
  unresolvedGaps: string[];
  confidence: "high" | "medium" | "low";
  validation: FactValidationSummary;
}

interface FactValidationSummary {
  parserVersion: 1;
  totalItems: number;
  acceptedItems: number;
  rejectedItems: number;
  rejectionReasons: Record<string, number>;
  sanitizedFields: Record<string, number>;
}

const PIPELINE_VERSION = 2;
const MAX_FINAL_FACTS = 10;
const MAX_EVIDENCE_FOR_MODEL = 12;
const MAX_EVIDENCE_ATTEMPTS = 16;
const TARGET_USABLE_EVIDENCE = 4;
const MAX_EVIDENCE_EXCERPT = 3_500;
const MAX_MODEL_EVIDENCE_EXCERPT = 1_600;
// The compact facts-first contract and per-item checkpoints now bound failure
// impact. The current official non-thinking API defaults to 8K output, and the
// audited peak-price reservation remains below the per-run USD 0.10 ceiling.
const PIPELINE_GENERATION_MAX_OUTPUT_TOKENS = 8_192;

type EvidenceWindowStatus = "inside" | "unknown" | "outside";

interface EvidenceWindowAudit {
  inside: number;
  unknownDate: number;
  outside: number;
}

function knownPublicationTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

/**
 * Coverage is a publication window. Event dates and discovery timestamps are
 * deliberately not substitutes for a source publication date: a newly found
 * old article must not become a new weekly event. Sources without a reliable
 * publication date remain eligible as explicitly time-unconfirmed clues.
 */
export function evidencePublicationWindowStatus(
  publishedAt: string | null | undefined,
  start: Date,
  end: Date,
): EvidenceWindowStatus {
  const knownPublishedAt = knownPublicationTimestamp(publishedAt);
  if (!knownPublishedAt) return "unknown";
  const parsed = new Date(knownPublishedAt);
  // Topic windows are calendar-day ranges. Provider dates are frequently
  // normalized to midnight, so comparing instants would wrongly exclude a
  // source from the first day when the run started later that morning.
  const day = parsed.toISOString().slice(0, 10);
  const firstDay = start.toISOString().slice(0, 10);
  const lastDay = end.toISOString().slice(0, 10);
  return day < firstDay || day > lastDay ? "outside" : "inside";
}

function factEventIsOutsideCoverage(eventDate: string | null, start: Date, end: Date): boolean {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return false;
  return eventDate < start.toISOString().slice(0, 10) || eventDate > end.toISOString().slice(0, 10);
}

function scopeEvidenceToPublicationWindow(
  evidence: IntelligencePipelineEvidence[],
  start: Date,
  end: Date,
): { eligible: IntelligencePipelineEvidence[]; audit: EvidenceWindowAudit } {
  const audit: EvidenceWindowAudit = { inside: 0, unknownDate: 0, outside: 0 };
  const eligible = evidence.filter((item) => {
    const status = evidencePublicationWindowStatus(item.publishedAt, start, end);
    if (status === "inside") audit.inside += 1;
    else if (status === "outside") audit.outside += 1;
    else audit.unknownDate += 1;
    return status !== "outside";
  });
  return { eligible, audit };
}

function markPublicationWindowExclusion(
  item: IntelligencePipelineEvidence,
  start: Date,
  end: Date,
): IntelligencePipelineEvidence {
  return evidencePublicationWindowStatus(item.publishedAt, start, end) === "outside"
    ? { ...item, failureReason: "published_outside_coverage" }
    : item;
}

function clean(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (Array.from(text).length > max) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_LIMIT");
  return text;
}

/** Provider-controlled search fields are bounded, never trusted as schema output. */
function boundedExternal(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, max).join("");
}

function cleanArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_SCHEMA");
  return value.map((item) => clean(item, maxChars)).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const value = raw.trim();
  if (!value || value.length > 64_000) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_TOP_LEVEL_SCHEMA");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_JSON_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_TOP_LEVEL_SCHEMA");
  return parsed as Record<string, unknown>;
}

function validCalendarDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INTELLIGENCE_PIPELINE_EVENT_DATE_SCHEMA");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw new Error("INTELLIGENCE_PIPELINE_EVENT_DATE_SCHEMA");
  }
  return value;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] || 0) + 1;
}

function modelString(value: unknown, max: number, field: string, required = true): string {
  if (typeof value !== "string") {
    if (!required && (value === null || value === undefined)) return "";
    throw new Error(`item_field_type:${field}`);
  }
  const result = clean(value, max);
  if (required && !result) throw new Error(`item_field_empty:${field}`);
  return result;
}

function modelStringArray(value: unknown, maxItems: number, maxChars: number, field: string): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    throw new Error(`item_array_schema:${field}`);
  }
  return value.map((item) => clean(item, maxChars)).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
}

function safeModelGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => boundedExternal(item, 180)).filter(Boolean).slice(0, 12);
}

function rejectionReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (/UNKNOWN_EVIDENCE/.test(message)) return "unknown_evidence";
  if (/EVENT_DATE_SCHEMA/.test(message)) return "invalid_event_date";
  if (/OUTPUT_LIMIT/.test(message)) return "field_limit";
  if (/^item_field_type:/.test(message)) return "field_type";
  if (/^item_field_empty:/.test(message)) return "missing_required_field";
  if (/^item_array_schema:/.test(message)) return "array_schema";
  return "item_schema";
}

function modelValue(item: Record<string, unknown>, verbose: string, compact: string): unknown {
  return item[verbose] !== undefined ? item[verbose] : item[compact];
}

function structuredAttributeKind(value: unknown): StructuredAttributeKind | null {
  return value === "round" || value === "amount" || value === "percentage"
    || value === "party" || value === "role" || value === "valuation"
    ? value : null;
}

function roleEvidencePhrase(value: string): string {
  const roles: Record<string, string> = {
    "lead-investor": "lead investor 领投",
    "participating-investor": "participating investor 参投",
    buyer: "buyer 收购方",
    seller: "seller 出售方",
    target: "target company 被收购方",
  };
  return roles[value] || value;
}

function structuredAttributeLabel(kind: StructuredAttributeKind): string {
  return {
    round: "轮次",
    amount: "金额",
    percentage: "比例",
    party: "交易参与方",
    role: "参与方角色",
    valuation: "估值",
  }[kind];
}

function evidenceTextForFact(entry: IntelligencePipelineEvidence): string {
  return entry.evidenceStatus === "full" && entry.contentExcerpt
    ? entry.contentExcerpt
    : `${entry.title}\n${entry.contentExcerpt || entry.snippet}`;
}

function validateStructuredAttributes(
  value: unknown,
  evidenceById: Map<string, IntelligencePipelineEvidence>,
  primarySubject: string,
  eventType: string,
  sanitizedFields: Record<string, number>,
): { supported: SupportedStructuredAttribute[]; rejectedLabels: string[] } {
  if (value === undefined || value === null) return { supported: [], rejectedLabels: [] };
  if (!Array.isArray(value)) {
    increment(sanitizedFields, "attribute_schema_removed");
    return { supported: [], rejectedLabels: ["结构化属性"] };
  }
  const supported: SupportedStructuredAttribute[] = [];
  const rejectedLabels: string[] = [];
  for (const raw of value.slice(0, 16)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      increment(sanitizedFields, "attribute_schema_removed");
      continue;
    }
    const row = raw as Record<string, unknown>;
    const kind = structuredAttributeKind(modelValue(row, "kind", "k"));
    if (!kind) {
      increment(sanitizedFields, "attribute_kind_removed");
      continue;
    }
    let attributeValue = "";
    let entity = "";
    let role = "";
    let evidenceIds: string[] = [];
    try {
      attributeValue = modelString(modelValue(row, "value", "v"), 120, "attribute.value");
      entity = modelString(modelValue(row, "entity", "n"), 100, "attribute.entity", false);
      role = modelString(modelValue(row, "role", "o"), 60, "attribute.role", false);
      evidenceIds = modelStringArray(modelValue(row, "evidenceIds", "ids"), 4, 80, "attribute.evidenceIds");
    } catch {
      increment(sanitizedFields, "attribute_schema_removed");
      rejectedLabels.push(structuredAttributeLabel(kind));
      continue;
    }
    if (!evidenceIds.length || evidenceIds.some((id) => !evidenceById.has(id))) {
      increment(sanitizedFields, "attribute_unknown_evidence_removed");
      rejectedLabels.push(structuredAttributeLabel(kind));
      continue;
    }
    const evidence = evidenceIds.map((id) => evidenceById.get(id)!);
    const evidenceTexts = evidence.map(evidenceTextForFact);
    const roleText = kind === "role" ? roleEvidencePhrase(role || attributeValue) : "";
    const validation = validateEvidenceBoundClaim(evidenceTexts, {
      primarySubject,
      subjects: [primarySubject, entity].filter(Boolean),
      eventText: `${primarySubject} ${eventType}`,
      eventType,
      attributeText: `${primarySubject} ${eventType} ${attributeValue} ${entity} ${roleText}`,
    });
    if (!validation.subjectSupported || !validation.eventActionSupported || validation.unsupportedAttributes.length) {
      increment(sanitizedFields, `unsupported_${kind}_removed`);
      rejectedLabels.push(structuredAttributeLabel(kind));
      continue;
    }
    supported.push({
      kind,
      value: attributeValue,
      entity: entity || null,
      role: role || null,
      evidenceIds,
    });
  }
  return {
    supported,
    rejectedLabels: [...new Set(rejectedLabels)],
  };
}

function renderStructuredFact(
  primarySubject: string,
  eventType: string,
  attributes: SupportedStructuredAttribute[],
): { headline: string; summary: string; entities: string[] } {
  const round = attributes.find((attribute) => attribute.kind === "round")?.value;
  const party = attributes.find((attribute) => attribute.kind === "party")?.value;
  const facts = attributes.map((attribute) => attribute.value).filter((value, index, all) => all.indexOf(value) === index);
  const headline = boundedExternal(`${primarySubject}${round || ""}${eventType}${round ? "" : party || ""}`, 120);
  const summary = boundedExternal(
    `${primarySubject}${eventType}${facts.length ? `；${facts.join("；")}` : ""}。`,
    600,
  );
  const entities = [primarySubject, ...attributes.map((attribute) => attribute.entity).filter((value): value is string => !!value)]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
  return { headline, summary, entities };
}

function normalizedFactIdentityText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Exact model-row identity is deliberately stricter than semantic event merging:
 * it removes duplicate streamed rows without collapsing two events that merely
 * share a URL, company or topic. Paraphrased multi-source events are merged later
 * by the established subject/action/counterparty/date quality gate.
 */
function exactFactIdentity(fact: ExtractedFact): string {
  return [
    normalizedFactIdentityText(fact.headline),
    normalizedFactIdentityText(fact.summary),
    normalizedFactIdentityText(fact.eventType),
    fact.eventDate || normalizedFactIdentityText(fact.eventTimeText || ""),
    [...fact.entities].map(normalizedFactIdentityText).filter(Boolean).sort().join("|"),
  ].join("::");
}

function mergeExactFactRows(facts: ExtractedFact[], sanitizedFields: Record<string, number>): ExtractedFact[] {
  const merged = new Map<string, ExtractedFact>();
  const statusRank = { context: 0, reported: 1, confirmed: 2 } as const;
  const relevanceRank = { low: 0, medium: 1, high: 2 } as const;
  for (const fact of facts) {
    const key = exactFactIdentity(fact);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...fact, evidenceIds: [...fact.evidenceIds] });
      continue;
    }
    increment(sanitizedFields, "duplicate_event_merged");
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...fact.evidenceIds])].slice(0, 6);
    if (statusRank[fact.status] > statusRank[existing.status]) existing.status = fact.status;
    if (relevanceRank[fact.relevance] > relevanceRank[existing.relevance]) existing.relevance = fact.relevance;
  }
  return [...merged.values()];
}

function parseFactBundle(raw: string, evidenceById: Map<string, IntelligencePipelineEvidence>, maxItems: number, preserveStoredValidation = false): FactBundle {
  const row = parseJsonObject(raw);
  const overview = typeof row.overview === "string" ? boundedExternal(row.overview, 1_600) : "";
  const factLimit = Math.max(1, Math.min(MAX_FINAL_FACTS, Math.floor(maxItems)));
  if (!Array.isArray(row.facts)) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_TOP_LEVEL_SCHEMA");
  const reasons: Record<string, number> = {};
  const sanitizedFields: Record<string, number> = {};
  const facts: ExtractedFact[] = [];
  const rawFacts = row.facts.slice(0, 50);
  if (row.facts.length > rawFacts.length) reasons.item_limit = row.facts.length - rawFacts.length;
  for (const value of rawFacts) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("item_schema");
      const item = value as Record<string, unknown>;
      const evidenceIds = modelStringArray(modelValue(item, "evidenceIds", "ids"), 6, 80, "evidenceIds");
      if (!evidenceIds.length || evidenceIds.some((id) => !evidenceById.has(id))) throw new Error("INTELLIGENCE_PIPELINE_UNKNOWN_EVIDENCE");
      const evidence = evidenceIds.map((id) => evidenceById.get(id)!);
      let rawEventDate: string | null = null;
      const eventDateValue = preserveStoredValidation && item.proposedEventDate !== undefined
        ? item.proposedEventDate
        : modelValue(item, "eventDate", "d");
      try { rawEventDate = validCalendarDate(eventDateValue); } catch { increment(sanitizedFields, "event_date_dropped"); }
      const headline = modelString(modelValue(item, "headline", "h"), 120, "headline");
      const summary = modelString(modelValue(item, "summary", "s"), 600, "summary");
      const assessment = modelString(modelValue(item, "assessment", "a"), 400, "assessment", false);
      const entities = modelStringArray(modelValue(item, "entities", "e"), 8, 100, "entities");
      const eventType = modelString(modelValue(item, "eventType", "t"), 80, "eventType");
      const relevanceReason = modelString(modelValue(item, "relevanceReason", "rr"), 240, "relevanceReason", false);
      const primarySubject = modelString(modelValue(item, "primarySubject", "p"), 100, "primarySubject", false)
        || extractEventEntity(`${headline} ${summary}`) || entities[0] || "";
      const structuredAttributesValue = modelValue(item, "attributes", "x");
      const hasStructuredAttributes = structuredAttributesValue !== undefined;
      const context: EventTimeEvidenceContext = hasStructuredAttributes ? {
        primarySubject,
        subjects: primarySubject ? [primarySubject] : [],
        // Preserve the proposed event action for evidence matching. Structured
        // attributes are still validated independently below, so this cannot
        // promote an unsupported amount, participant or role.
        eventText: `${headline} ${summary}`,
        eventType,
        attributeText: `${primarySubject} ${eventType}`,
      } : {
        primarySubject,
        subjects: entities,
        eventText: `${headline} ${summary}`,
        eventType,
        attributeText: `${headline} ${summary} ${assessment} ${relevanceReason}`,
      };
      // A successful fetch makes the fetched excerpt authoritative for fact binding.
      // Do not let a search title silently override an unrelated/contradictory body.
      const evidenceTexts = evidence.map((entry) => entry.evidenceStatus === "full" && entry.contentExcerpt
        ? entry.contentExcerpt
        : `${entry.title}\n${entry.contentExcerpt || entry.snippet}`);
      const claimValidation = validateEvidenceBoundClaim(evidenceTexts, context);
      if (!claimValidation.subjectSupported) {
        increment(reasons, "subject_not_supported");
        continue;
      }
      if (!hasStructuredAttributes && claimValidation.unsupportedAttributes.length) {
        increment(reasons, "unsupported_attributes");
        continue;
      }
      const eventActionSupported = claimValidation.eventActionSupported;
      const structured = hasStructuredAttributes
        ? validateStructuredAttributes(structuredAttributesValue, evidenceById, primarySubject, eventType, sanitizedFields)
        : { supported: [] as SupportedStructuredAttribute[], rejectedLabels: [] as string[] };
      const rendered = hasStructuredAttributes
        ? renderStructuredFact(primarySubject, eventType, structured.supported)
        : { headline, summary, entities };
      const safeContext: EventTimeEvidenceContext = {
        primarySubject,
        subjects: rendered.entities,
        // Structured rendering deliberately drops unsupported attributes, but it
        // can also collapse a supported event phrase to only "subject + type".
        // Keep the model's event wording solely for evidence-bound date matching;
        // amounts, parties and other user-visible fields still come exclusively
        // from the structured attribute gate above.
        eventText: hasStructuredAttributes ? `${headline} ${summary}` : `${rendered.headline} ${rendered.summary}`,
        eventType,
        attributeText: `${rendered.headline} ${rendered.summary}`,
      };
      const eventTime = resolveEvidenceBackedEventTime(rawEventDate, evidenceTexts, safeContext);
      const sanitizeClaimText = (text: string) => extractExplicitCalendarDates(text).reduce((safe, date) => {
        const resolved = resolveEvidenceBackedEventTime(date, evidenceTexts, safeContext);
        if (resolved.eventDate === date) return safe;
        increment(sanitizedFields, "unsupported_date_removed");
        return replaceUnsupportedEventDate(safe, date, resolved.eventTimeText);
      }, text);
      const safeAssessment = hasStructuredAttributes && assessment
        ? (() => {
            const validation = validateEvidenceBoundClaim(evidenceTexts, {
              ...safeContext,
              attributeText: assessment,
            });
            if (validation.unsupportedAttributes.length) {
              increment(sanitizedFields, "unsupported_assessment_removed");
              return "";
            }
            return sanitizeClaimText(assessment);
          })()
        : sanitizeClaimText(assessment);
      const rawStatus = modelValue(item, "status", "st");
      const requestedStatus = rawStatus === "confirmed" || rawStatus === "context" ? rawStatus : "reported";
      const status = !eventActionSupported || structured.rejectedLabels.length > 0
        ? "reported"
        : requestedStatus === "confirmed" && !evidence.some((entry) => entry.evidenceStatus === "full") ? "reported" : requestedStatus;
      facts.push({
        headline: sanitizeClaimText(rendered.headline),
        summary: sanitizeClaimText(rendered.summary),
        assessment: safeAssessment,
        eventDate: eventTime.eventDate,
        proposedEventDate: rawEventDate,
        eventTimeText: eventTime.eventTimeText,
        eventType,
        entities: rendered.entities,
        status,
        relevance: modelValue(item, "relevance", "r") === "high" || modelValue(item, "relevance", "r") === "low"
          ? modelValue(item, "relevance", "r") as "high" | "low"
          : "medium",
        relevanceReason: hasStructuredAttributes ? "事件及保留属性均已逐项关联来源" : relevanceReason,
        evidenceIds: [...new Set([...evidenceIds, ...structured.supported.flatMap((attribute) => attribute.evidenceIds)])].slice(0, 6),
        rejectedAttributeLabels: structured.rejectedLabels,
      });
    } catch (error) {
      increment(reasons, rejectionReason(error));
    }
  }
  const mergedFacts = mergeExactFactRows(facts, sanitizedFields);
  const limitedFacts = mergedFacts.slice(0, factLimit);
  if (mergedFacts.length > limitedFacts.length) {
    reasons.item_limit = (reasons.item_limit || 0) + (mergedFacts.length - limitedFacts.length);
  }
  const computedValidation: FactValidationSummary = {
    parserVersion: 1,
    totalItems: row.facts.length,
    acceptedItems: limitedFacts.length,
    rejectedItems: Object.values(reasons).reduce((sum, count) => sum + count, 0),
    rejectionReasons: reasons,
    sanitizedFields,
  };
  const stored = preserveStoredValidation && row.validation && typeof row.validation === "object" && !Array.isArray(row.validation)
    ? row.validation as Partial<FactValidationSummary>
    : null;
  const validation = stored?.parserVersion === 1
    && Number.isSafeInteger(stored.totalItems) && Number(stored.totalItems) >= limitedFacts.length
    && stored.rejectionReasons && typeof stored.rejectionReasons === "object"
      ? {
          parserVersion: 1 as const,
          totalItems: Number(stored.totalItems),
          acceptedItems: limitedFacts.length,
          rejectedItems: Math.max(0, Number(stored.totalItems) - limitedFacts.length - Number(stored.sanitizedFields?.duplicate_event_merged || 0)),
          rejectionReasons: stored.rejectionReasons as Record<string, number>,
          sanitizedFields: stored.sanitizedFields && typeof stored.sanitizedFields === "object" ? stored.sanitizedFields as Record<string, number> : {},
        }
      : computedValidation;
  return {
    overview,
    facts: limitedFacts,
    unresolvedGaps: [
      ...safeModelGaps(row.unresolvedGaps ?? row.g),
      ...(validation.rejectedItems ? [`${validation.rejectedItems} 条事项未通过逐项结构或证据校验，已隔离`] : []),
    ].slice(0, 12),
    confidence: (row.confidence ?? row.c) === "high" || (row.confidence ?? row.c) === "medium"
      ? (row.confidence ?? row.c) as "high" | "medium"
      : "low",
    validation,
  };
}

function evidenceKey(url: string): string {
  return `source:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

function fromSearchItem(item: WebSearchItem, provider: string | null): IntelligencePipelineEvidence | null {
  const url = safeIntelligenceExternalUrl(item.url);
  if (!url) return null;
  return {
    itemKey: evidenceKey(url),
    url,
    title: boundedExternal(item.title, 400),
    sourceName: boundedExternal(item.siteName || item.domain || "来源", 200),
    sourceTier: item.sourceTier,
    retrievalProvider: provider || item.searchProviders?.[0] || null,
    query: boundedExternal(item.query, 500),
    snippet: boundedExternal(item.snippet, 1_200),
    contentExcerpt: "",
    publishedAt: knownPublicationTimestamp(item.publishedAt),
    fetchedAt: null,
    evidenceStatus: null,
    failureReason: null,
  };
}

function toEvidenceCandidate(item: IntelligencePipelineEvidence): EvidenceCandidate {
  return {
    title: item.title,
    publishedAt: item.publishedAt || undefined,
    sourceUrl: item.url,
    origin: "web-search",
    content: item.snippet,
    evidenceStatus: item.evidenceStatus || undefined,
  };
}

function evidenceAcquisitionScore(item: IntelligencePipelineEvidence, input: IntelligenceTaskInput): number {
  const text = `${item.title} ${item.snippet}`.toLocaleLowerCase();
  const sourceTier = { S: 5, A: 4, B: 3, C: 2, D: 1 }[item.sourceTier || "D"];
  const matched = (terms: string[], weight: number) => terms.reduce((score, term) => {
    const normalized = term.trim().toLocaleLowerCase();
    return score + (normalized && text.includes(normalized) ? weight : 0);
  }, 0);
  return sourceTier
    + matched(input.entities, 6)
    + matched(input.eventTypes || [], 4)
    + matched(input.keywords, 2)
    + matched(input.topics, 1);
}

function selectEvidenceForAcquisition(
  evidence: IntelligencePipelineEvidence[],
  input: IntelligenceTaskInput,
  limit = MAX_EVIDENCE_FOR_MODEL,
): IntelligencePipelineEvidence[] {
  return evidence
    .map((item, index) => ({ item, index, score: evidenceAcquisitionScore(item, input) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((row) => row.item);
}

function mergeAcquired(base: IntelligencePipelineEvidence, acquired: EvidenceCandidate): IntelligencePipelineEvidence {
  return {
    ...base,
    title: boundedExternal(acquired.title || base.title, 400),
    contentExcerpt: boundedExternal(acquired.content || base.snippet, MAX_EVIDENCE_EXCERPT),
    publishedAt: knownPublicationTimestamp(acquired.evidencePublishedAt || acquired.publishedAt || base.publishedAt),
    fetchedAt: new Date().toISOString(),
    evidenceStatus: acquired.evidenceStatus || "unavailable",
    failureReason: acquired.evidenceFailureReason || null,
  };
}

async function acquireEvidenceWithBackfill(
  evidence: IntelligencePipelineEvidence[],
  input: IntelligenceTaskInput,
  store: IntelligencePipelineStore,
  acquirer: EvidenceAcquirer,
  coverage: { start: Date; end: Date },
): Promise<{ evidence: IntelligencePipelineEvidence[]; attemptedIds: string[] }> {
  let current = scopeEvidenceToPublicationWindow(evidence, coverage.start, coverage.end).eligible;
  const attemptedIds = new Set(current.filter((item) => item.evidenceStatus !== null).map((item) => item.itemKey));
  let remaining = Math.max(0, MAX_EVIDENCE_ATTEMPTS - attemptedIds.size);
  let firstBatch = attemptedIds.size === 0;
  while (remaining > 0) {
    const usable = current.filter((item) => item.evidenceStatus === "full" || item.evidenceStatus === "partial").length;
    if (usable >= TARGET_USABLE_EVIDENCE) break;
    const rankedUnattempted = selectEvidenceForAcquisition(
      current.filter((item) => item.evidenceStatus === null),
      input,
      current.length,
    );
    if (!rankedUnattempted.length) break;
    const desired = firstBatch
      ? Math.min(MAX_EVIDENCE_FOR_MODEL, remaining)
      : Math.min(Math.max(1, TARGET_USABLE_EVIDENCE - usable), remaining);
    const batch = rankedUnattempted.slice(0, desired);
    for (const item of batch) attemptedIds.add(item.itemKey);
    await store.saveCheckpoint({
      stage: "evidence",
      status: "running",
      payload: { selectedEvidenceIds: [...attemptedIds] },
      diagnostics: { attempted: attemptedIds.size, usable },
    });
    const acquired = await acquirer(batch.map(toEvidenceCandidate), { maxUrls: batch.length });
    const updated = batch.map((item, index) => markPublicationWindowExclusion(
      mergeAcquired(item, acquired.candidates[index]!),
      coverage.start,
      coverage.end,
    ));
    await store.upsertEvidence(updated);
    current = scopeEvidenceToPublicationWindow(
      await store.listEvidence(),
      coverage.start,
      coverage.end,
    ).eligible;
    remaining = Math.max(0, MAX_EVIDENCE_ATTEMPTS - attemptedIds.size);
    firstBatch = false;
  }
  return { evidence: current, attemptedIds: [...attemptedIds] };
}

function taskUnderstanding(input: IntelligenceTaskInput, start: Date, end: Date) {
  return {
    version: PIPELINE_VERSION,
    originalRequest: clean(input.originalRequest || "", 4_000),
    name: clean(input.name, 300),
    keywords: input.keywords.slice(0, 30),
    regions: input.regions.slice(0, 20),
    maxItems: input.maxItems,
    topics: input.topics.slice(0, 20),
    entities: input.entities.slice(0, 20),
    eventTypes: (input.eventTypes || []).slice(0, 12),
    includeRequirements: input.includeRequirements.slice(0, 20),
    excludeRequirements: input.excludeRequirements.slice(0, 20),
    outputInstructions: clean(input.outputInstructions, 2_000),
    sourcePolicy: input.sourcePolicy || {},
    personalizationPrompt: clean(input.personalizationPrompt || "", 4_000),
    personalizationMeta: input.personalizationMeta || null,
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
  };
}

function pipelineQueries(input: IntelligenceTaskInput, limit: number): string[] {
  const required = [...input.entities, ...input.topics, ...input.keywords, ...(input.eventTypes || []), ...input.regions, ...input.includeRequirements]
    .map((value) => value.trim()).filter(Boolean);
  const base = input.originalRequest?.trim() || input.name.trim();
  const planned = planIntelligenceQueries(input);
  return [base, ...planned]
    .map((query) => clean(`${query} ${required.filter((term) => !query.includes(term)).join(" ")}`, 500))
    .filter(Boolean)
    .filter((query, index, list) => list.indexOf(query) === index)
    .slice(0, limit);
}

function compactEvidenceExcerpt(item: IntelligencePipelineEvidence, input: IntelligenceTaskInput): string {
  const raw = boundedExternal(item.contentExcerpt || item.snippet, MAX_EVIDENCE_EXCERPT);
  const sentences = raw.match(/[^。！？!?\n]+[。！？!?\n]?/g)?.map((sentence, index) => ({ sentence: sentence.trim(), index })).filter((row) => row.sentence) ?? [];
  const terms = [
    ...input.entities,
    ...input.topics,
    ...input.keywords,
    ...(input.eventTypes || []),
    "融资", "投资", "并购", "收购", "股权", "轮", "金额", "领投", "跟投",
  ].map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  const ranked = sentences.map((row) => ({
    ...row,
    score: terms.reduce((score, term) => score + (row.sentence.toLocaleLowerCase().includes(term) ? 1 : 0), 0)
      - (/无关|不涉及|未提及|not related|unrelated/i.test(row.sentence) ? 4 : 0),
  })).filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12)
    .sort((left, right) => left.index - right.index);
  const chosen = ranked.length ? ranked : sentences.slice(0, 6);
  let result = "";
  for (const row of chosen) {
    const next = `${result}${result ? " " : ""}${row.sentence}`;
    if (Array.from(next).length > MAX_MODEL_EVIDENCE_EXCERPT) break;
    result = next;
  }
  return result || Array.from(raw).slice(0, MAX_MODEL_EVIDENCE_EXCERPT).join("");
}

function factPrompt(input: IntelligenceTaskInput, start: Date, end: Date, evidence: IntelligencePipelineEvidence[]): string {
  const materials = evidence.slice(0, MAX_EVIDENCE_FOR_MODEL).map((item) => ({
    evidenceId: item.itemKey,
    title: item.title,
    source: item.sourceName,
    publishedAt: item.publishedAt,
    evidenceStatus: item.evidenceStatus,
    excerpt: compactEvidenceExcerpt(item, input),
  }));
  const criteria = {
    request: input.originalRequest || input.name,
    topics: input.topics.slice(0, 20),
    entities: input.entities.slice(0, 20),
    keywords: input.keywords.slice(0, 30),
    regions: input.regions.slice(0, 20),
    eventTypes: (input.eventTypes || []).slice(0, 12),
    include: input.includeRequirements.slice(0, 20),
    exclude: input.excludeRequirements.slice(0, 20),
    sourcePolicy: input.sourcePolicy || {},
    personalization: input.personalizationPrompt || "",
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
  };
  const factLimit = Math.max(1, Math.min(MAX_FINAL_FACTS, Math.floor(input.maxItems)));
  return [
    "只输出一个紧凑 JSON 对象；不要 Markdown、解释、思考过程或重复证据正文。",
    "只基于下列已持久化证据提取投资事项；不得搜索、访问 URL、引入新来源或猜测日期。",
    `任务：${JSON.stringify(criteria)}`,
    `证据：${JSON.stringify(materials)}`,
    "JSON 必须以 facts 为第一个字段，使用这个紧凑结构：",
    `{"facts":[{"p":"事件主主体","h":"模型原始标题≤80字","s":"模型原始摘要≤260字","a":"投资判断≤180字","d":"YYYY-MM-DD或null","t":"事件类型≤40字","e":["主体/交易方，最多6个"],"x":[{"k":"round|amount|percentage|party|role|valuation","v":"来源中的原始口径","n":"关联主体或null","o":"角色或null","ids":["支持该属性的evidenceId"]}],"st":"confirmed|reported|context","r":"high|medium|low","rr":"相关性≤120字","ids":["支持主体和事件动作的evidenceId，最多3个"]}],"g":["资料缺口≤120字，最多6条"],"c":"high|medium|low"}`,
    `最多 ${factLimit} 条 facts；同一事项只输出一次。不要在 h/s/a/rr 中复制来源标题、URL或整段正文。`,
    "每项必须独立完整并引用现有 evidenceId。只有 evidenceStatus=full 的正文可支持 confirmed；不确定日期必须为 null。",
    "同一来源包含多个轮次、交易对象或事件时必须拆成多个 facts；每个 x 属性单独引用支持它的 evidenceId。",
    "文章发布日不等于事件日。金额、轮次、投资方和事件日期都必须由该事项引用的证据明确支持，否则删除该属性或降为 reported，并把缺口写入 g。",
    "金额限定词属于事实本身，必须原样保留：近/约/超过/至少/不超过/数亿元不得改写成精确金额。",
  ].join("\n");
}

/** Extracts only fully closed fact objects from the required facts-first JSON shape. */
function completeStreamedFactRows(raw: string): unknown[] {
  const start = /^\s*\{\s*"facts"\s*:\s*\[/.exec(raw);
  if (!start) return [];
  const rows: unknown[] = [];
  let cursor = start[0].length;
  while (cursor < raw.length) {
    while (/\s|,/.test(raw[cursor] || "")) cursor += 1;
    if (raw[cursor] === "]" || cursor >= raw.length) break;
    if (raw[cursor] !== "{") break;
    const objectStart = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let completeAt = -1;
    for (; cursor < raw.length; cursor += 1) {
      const char = raw[cursor]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{" || char === "[") depth += 1;
      if (char === "}" || char === "]") depth -= 1;
      if (depth === 0) { completeAt = cursor + 1; break; }
    }
    if (completeAt < 0) break;
    try { rows.push(JSON.parse(raw.slice(objectStart, completeAt))); } catch { rows.push(null); }
    cursor = completeAt;
  }
  return rows;
}

function sourceDiagnostics(retrieval: RetrievalResult, evidence: IntelligencePipelineEvidence[]) {
  return evidence.map((item) => ({
    url: item.url,
    title: item.title,
    source: item.sourceName,
    sourceTier: item.sourceTier,
    provider: item.retrievalProvider,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    evidenceStatus: item.evidenceStatus || "not_selected" as const,
    exclusionReason: item.failureReason,
  }));
}

function itemFromFact(fact: ExtractedFact, evidenceById: Map<string, IntelligencePipelineEvidence>, generatedAt: string): Candidate {
  const evidence = fact.evidenceIds.map((id) => evidenceById.get(id)!).filter(Boolean);
  const primary = evidence.find((item) => item.evidenceStatus === "full") || evidence[0]!;
  const hasKnownPublicationDate = evidence.some((item) => !!knownPublicationTimestamp(item.publishedAt));
  const primaryPublishedAt = knownPublicationTimestamp(primary.publishedAt) || "";
  // A model cannot promote an event into a confirmed item when neither the
  // source publication date nor the evidence-bound event date locates it in
  // this run. Keep the evidence as a useful clue; a trustworthy in-window
  // event date is sufficient even when the publisher omitted its own date.
  const effectiveStatus = fact.status === "confirmed" && !hasKnownPublicationDate && !fact.eventDate
    ? "reported"
    : fact.status;
  return {
    id: `pipeline:${createHash("sha256").update(exactFactIdentity(fact)).digest("hex").slice(0, 24)}`,
    title: fact.headline,
    content: fact.summary,
    summary: fact.summary,
    investmentNote: fact.assessment || undefined,
    source: primary.sourceName,
    sourceUrl: primary.url,
    sourceUrls: evidence.map((item) => item.url),
    publishedAt: primaryPublishedAt,
    timeUnconfirmed: !primaryPublishedAt && !fact.eventDate,
    subject: fact.entities.join("、") || fact.headline,
    region: null,
    kind: effectiveStatus === "confirmed" ? "fact" : "other",
    sourceTier: primary.sourceTier,
    origin: "web-search",
    domain: new URL(primary.url).hostname,
    importance: fact.relevance,
    relevance: fact.relevance,
    relevanceReason: fact.relevanceReason,
    confidence: effectiveStatus === "confirmed" ? "high" : effectiveStatus === "reported" ? "medium" : "low",
    isClue: effectiveStatus === "reported",
    followUpReason: effectiveStatus === "reported"
      ? !hasKnownPublicationDate && !fact.eventDate
        ? "来源发布日期和事件日期均待确认"
        : fact.rejectedAttributeLabels?.length
        ? `待继续核验：${fact.rejectedAttributeLabels.join("、")}`
        : "来源或事件要素尚不足以充分确认"
      : undefined,
    evidenceStatus: primary.evidenceStatus || "unavailable",
    publishedAtSource: primaryPublishedAt ? "evidence" : "unknown",
    publishedAtConfidence: primaryPublishedAt ? "high" : "unknown",
    eventType: fact.eventType,
    eventDate: fact.eventDate || undefined,
    eventTimeText: fact.eventTimeText || undefined,
    eventDateSupport: fact.eventDate ? "evidence" : undefined,
    discoveredAt: generatedAt,
    fetchedAt: primary.fetchedAt || generatedAt,
    supportLevel: effectiveStatus === "confirmed" ? "direct" : effectiveStatus === "context" ? "context" : "unknown",
  };
}

/**
 * A model may correctly be rejected for adding unsupported amount/investor/date
 * attributes even though a fetched source still contains a relevant capital
 * event. Preserve that user value as a deliberately sparse clue. The clue is
 * emitted only when the same evidence supports both the subject and event
 * action; no model-proposed transaction attributes are copied into it.
 */
function evidenceBackedFallbackClues(
  input: IntelligenceTaskInput,
  evidence: IntelligencePipelineEvidence[],
  generatedAt: string,
  coverage: { start: Date; end: Date },
): Candidate[] {
  const clues = new Map<string, Candidate>();
  const subjects = input.entities.map((value) => value.trim()).filter(Boolean);
  const configuredEventTypes = (input.eventTypes || []).map((value) => value.trim()).filter(Boolean);
  const eventTypes = (configuredEventTypes.length ? configuredEventTypes : input.keywords)
    .map((value) => value.trim()).filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  for (const source of evidence) {
    if (source.evidenceStatus !== "full" && source.evidenceStatus !== "partial") continue;
    const evidenceText = source.evidenceStatus === "full" && source.contentExcerpt
      ? source.contentExcerpt
      : `${source.title}\n${source.contentExcerpt || source.snippet}`;
    const sourceSubjects = subjects.filter((subject) => evidenceText.toLocaleLowerCase().includes(subject.toLocaleLowerCase()));
    // A rejected model item cannot introduce a new subject through this
    // fallback path. Without a task-scoped entity we keep the source visible,
    // but do not turn an inferred company name into a user-facing event clue.
    for (const subject of sourceSubjects) {
      for (const eventType of eventTypes) {
        const validation = validateEvidenceBoundClaim([evidenceText], {
          primarySubject: subject,
          subjects: [subject],
          eventText: `${subject}${eventType}`,
          eventType,
          attributeText: `${subject}${eventType}`,
        });
        if (!validation.subjectSupported || !validation.eventActionSupported || validation.unsupportedAttributes.length) continue;
        const eventContext: EventTimeEvidenceContext = {
          primarySubject: subject,
          subjects: [subject],
          eventText: `${subject} ${eventType}`,
          eventType,
          attributeText: `${subject} ${eventType}`,
        };
        const supportedEventDates = extractExplicitCalendarDates(evidenceText).filter((date) => (
          resolveEvidenceBackedEventTime(date, [evidenceText], eventContext).eventDate === date
        ));
        if (supportedEventDates.length > 0 && supportedEventDates.every((date) => (
          factEventIsOutsideCoverage(date, coverage.start, coverage.end)
        ))) continue;
        const key = `${subject.toLocaleLowerCase()}::${eventType.toLocaleLowerCase()}`;
        if (clues.has(key)) continue;
        clues.set(key, {
          id: `pipeline-clue:${createHash("sha256").update(`${key}:${source.url}`).digest("hex").slice(0, 24)}`,
          title: `${subject}${eventType}相关线索待核验`,
          content: `已获取 ${source.sourceName} 的可访问正文，其中提及 ${subject} 的${eventType}相关动态。`,
          summary: `已获取 ${source.sourceName} 的可访问正文，其中提及 ${subject} 的${eventType}相关动态；模型提取的具体交易要素未通过事实门禁。`,
          source: source.sourceName,
          sourceUrl: source.url,
          sourceUrls: [source.url],
          publishedAt: source.publishedAt || "",
          timeUnconfirmed: !source.publishedAt,
          subject,
          region: input.regions[0] || null,
          kind: "other",
          sourceTier: source.sourceTier,
          origin: "web-search",
          domain: new URL(source.url).hostname,
          importance: "medium",
          relevance: "high",
          relevanceReason: "来源正文同时支持主题主体与事件动作；具体交易属性仍未通过门禁",
          confidence: "low",
          isClue: true,
          followUpReason: "轮次、金额、投资方与事件时间仍需逐项核验",
          evidenceStatus: source.evidenceStatus,
          publishedAtSource: source.publishedAt ? "evidence" : "unknown",
          publishedAtConfidence: source.publishedAt ? "high" : "unknown",
          eventType,
          discoveredAt: generatedAt,
          fetchedAt: source.fetchedAt || generatedAt,
          supportLevel: "unknown",
        });
      }
    }
  }
  return [...clues.values()].slice(0, Math.max(1, Math.min(MAX_FINAL_FACTS, input.maxItems)));
}

function insufficientEvidenceBrief(
  input: IntelligenceTaskInput,
  start: Date,
  end: Date,
  generatedAt: string,
  retrieval: RetrievalResult,
  evidence: IntelligencePipelineEvidence[],
  provider: IntelligenceProvider,
  windowFilter: EvidenceWindowAudit,
): BriefResult {
  const sourceList = evidence.map((item) => ({ source: item.sourceName, url: item.url, publishedAt: item.publishedAt, sourceTier: item.sourceTier, origin: "web-search" }));
  const metadata = safeRetrievalMetadata(retrieval, {
    searchCandidates: evidence.length,
    relevancePassed: 0,
    relevanceDropped: evidence.length,
    evidence: {
      full: evidence.filter((item) => item.evidenceStatus === "full").length,
      partial: evidence.filter((item) => item.evidenceStatus === "partial").length,
      unavailable: evidence.filter((item) => item.evidenceStatus === "unavailable").length,
    },
    final: { facts: 0, clues: 0, trends: 0 },
  });
  metadata.sources = sourceDiagnostics(retrieval, evidence);
  return {
    taskName: input.name,
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
    generatedAt,
    itemCount: 0,
    importantFacts: [],
    trendSignals: [],
    otherItems: [],
    sourceList,
    metadata: {
      overview: evidence.length
        ? "本次已保存本期或日期待确认的候选来源，但可核验正文不足，暂时无法判断是否存在符合条件的新事项。"
        : windowFilter.outside > 0
          ? `本次命中的 ${windowFilter.outside} 个已知发布日期来源均不在报告窗口内，未形成本期新增；当前检索覆盖不足，不能据此断言市场上没有其他相关事项。`
          : "本次检索未获得可核验来源，这不等于市场上没有相关事项。",
      origins: ["web-search"],
      generationProvider: provider.id,
      generationModel: provider.model || null,
      retrieval: { ...metadata, coverageConclusion: "insufficient_evidence" },
      research: {
        mode: "pipeline-v2",
        pipelineVersion: PIPELINE_VERSION,
        stages: ["understanding", "retrieval", "evidence", "brief"],
        unresolvedGaps: [
          "可核验正文或相关来源不足",
          ...(windowFilter.outside > 0 ? [`${windowFilter.outside} 个已知发布日期来源不在本期窗口，已隔离`] : []),
        ],
        windowFilter,
      },
    },
  };
}

function buildBrief(
  input: IntelligenceTaskInput,
  start: Date,
  end: Date,
  generatedAt: string,
  retrieval: RetrievalResult,
  evidence: IntelligencePipelineEvidence[],
  bundle: FactBundle,
  provider: IntelligenceProvider,
  windowFilter: EvidenceWindowAudit,
): BriefResult {
  const evidenceById = new Map(evidence.map((item) => [item.itemKey, item]));
  const currentFacts = bundle.facts.filter((fact) => !factEventIsOutsideCoverage(
    fact.eventDate || fact.proposedEventDate,
    start,
    end,
  ));
  const outsideEventFacts = bundle.facts.length - currentFacts.length;
  const modelItems = currentFacts.map((fact) => itemFromFact(fact, evidenceById, generatedAt));
  // A fact rejected only because its explicit event date is outside the
  // requested period must not be reintroduced as a date-less fallback clue.
  const fallbackClues = modelItems.length === 0 && bundle.facts.length === 0
    ? evidenceBackedFallbackClues(input, evidence, generatedAt, { start, end })
    : [];
  const items = mergeEventCandidates([...modelItems, ...fallbackClues]);
  const importantFacts = items.filter((item) => item.kind === "fact");
  const otherItems = items.filter((item) => item.kind !== "fact");
  const metadata = safeRetrievalMetadata(retrieval, {
    searchCandidates: retrieval.results.length,
    relevancePassed: items.length,
    relevanceDropped: Math.max(0, retrieval.results.length - items.length),
    evidence: {
      full: evidence.filter((item) => item.evidenceStatus === "full").length,
      partial: evidence.filter((item) => item.evidenceStatus === "partial").length,
      unavailable: evidence.filter((item) => item.evidenceStatus === "unavailable").length,
    },
    final: { facts: importantFacts.length, clues: otherItems.filter((item) => item.isClue).length, trends: 0 },
  });
  metadata.sources = sourceDiagnostics(retrieval, evidence);
  const overview = items.length === 0
    ? outsideEventFacts > 0
      ? `本次已核验来源中有 ${outsideEventFacts} 条事项的明确事件日期不在报告窗口内，未作为本期新增发布；这不代表市场上没有其他相关事项。`
      : windowFilter.outside > 0
        ? `本次检索命中的 ${windowFilter.outside} 个已知发布日期来源不在报告窗口内；其余本期或日期待确认来源未形成通过事实级来源绑定的事项，不能据此断言市场上没有其他相关事项。`
      : "本次已核验部分来源，但没有形成通过事实级来源绑定的事项；这不代表市场上没有相关事项。"
    : `本次基于已核验来源形成 ${items.length} 条事项${retrieval.status === "success" ? "。" : "；来源覆盖不完整，结论仅适用于已获取证据。"}`;
  return {
    taskName: input.name,
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
    generatedAt,
    itemCount: items.length,
    importantFacts,
    trendSignals: [],
    otherItems,
    sourceList: evidence.map((item) => ({ source: item.sourceName, url: item.url, publishedAt: item.publishedAt, sourceTier: item.sourceTier, origin: "web-search" })),
    metadata: {
      overview,
      origins: ["web-search"],
      generationProvider: provider.id,
      generationModel: provider.model || null,
      retrieval: { ...metadata, coverageConclusion: items.length ? "items_found" : "insufficient_evidence" },
      research: {
        mode: "pipeline-v2",
        pipelineVersion: PIPELINE_VERSION,
        stages: ["understanding", "retrieval", "evidence", "facts", "brief"],
        unresolvedGaps: [
          ...bundle.unresolvedGaps,
          ...(windowFilter.outside > 0 ? [`${windowFilter.outside} 个已知发布日期来源不在本期窗口，已隔离`] : []),
          ...(outsideEventFacts > 0 ? [`${outsideEventFacts} 条明确事件日期不在本期窗口，已隔离为历史背景`] : []),
        ].slice(0, 12),
        windowFilter: { ...windowFilter, outsideEventFacts },
        confidence: bundle.confidence,
        validation: bundle.validation,
        evidenceFallbackClues: fallbackClues.length,
      },
    },
  };
}

function retrievalFromCheckpoint(checkpoint: IntelligencePipelineCheckpoint): RetrievalResult | null {
  const payload = checkpoint.payload;
  if (checkpoint.status !== "completed" && checkpoint.status !== "partial") return null;
  if (payload.status !== "success" && payload.status !== "partial" && payload.status !== "failed") return null;
  if (!Array.isArray(payload.providers) || !Array.isArray(payload.results)) return null;
  return { status: payload.status, providers: payload.providers as RetrievalResult["providers"], results: payload.results as WebSearchItem[], fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : undefined };
}

export async function runIntelligencePipeline(
  input: IntelligenceTaskInput,
  coverage: { start: Date; end: Date },
  generatedAt: Date,
  dependencies: IntelligencePipelineDependencies,
): Promise<BriefResult> {
  const { store, generationProvider } = dependencies;
  await store.saveCheckpoint({ stage: "understanding", status: "completed", payload: taskUnderstanding(input, coverage.start, coverage.end), diagnostics: {} });

  const plannedQueries = pipelineQueries(input, Math.max(1, Math.min(4, dependencies.maxSearchQueries ?? 2)));
  let retrievalCheckpoint = await store.loadCheckpoint("retrieval");
  let retrieval = retrievalCheckpoint ? retrievalFromCheckpoint(retrievalCheckpoint) : null;
  if (!retrieval) {
    const savedBeforeSearch = await store.listEvidence();
    if (retrievalCheckpoint && retrievalCheckpoint.status !== "failed" && savedBeforeSearch.length) {
      retrieval = {
        status: "partial",
        providers: [{ provider: "checkpoint-recovery", attempted: true, succeeded: true, queryCount: 0, resultCount: savedBeforeSearch.length, status: "partial", partialFailure: true, coverageCapability: "coarse", errorCode: "search_interrupted_after_candidates_saved" }],
        results: savedBeforeSearch.map((item) => ({ title: item.title, url: item.url, siteName: item.sourceName, snippet: item.snippet, publishedAt: item.publishedAt, sourceTier: item.sourceTier, domain: new URL(item.url).hostname, query: item.query, searchProviders: item.retrievalProvider ? [item.retrievalProvider] : [] })),
        fetchedAt: new Date().toISOString(),
      };
      await store.saveCheckpoint({ stage: "retrieval", status: "partial", payload: { ...retrieval }, diagnostics: { recoveredFromSavedCandidates: true } });
    } else if (retrievalCheckpoint && retrievalCheckpoint.status === "uncertain") {
      throw new Error("INTELLIGENCE_PIPELINE_RETRIEVAL_UNCERTAIN");
    } else {
      await store.saveCheckpoint({ stage: "retrieval", status: "running", payload: { queries: plannedQueries }, diagnostics: {} });
      try {
        retrieval = await dependencies.retrieval.retrieve({
          input,
          start: coverage.start,
          end: coverage.end,
          queries: plannedQueries,
          onBatch: async (batch) => {
            try {
              const persisted = batch.results
                .map((item) => fromSearchItem(item, batch.provider))
                .filter((item): item is IntelligencePipelineEvidence => !!item)
                .map((item) => markPublicationWindowExclusion(item, coverage.start, coverage.end));
            await store.upsertEvidence(persisted);
            } catch {
              // A completed provider response must never be followed by fallback calls when
              // its checkpoint could not be persisted. The caller can recover from the
              // durable provider ledger without paying for another search.
              throw new Error("INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED");
            }
          },
        });
      } catch (error) {
        // Waited provider branches may have durably saved useful candidates.
        // Preserve that boundary and expose an honest failed checkpoint rather
        // than letting a later stage snapshot an empty result.
        try {
          const saved = await store.listEvidence();
          const recoveredResults: WebSearchItem[] = saved.map((item) => ({
            title: item.title,
            url: item.url,
            siteName: item.sourceName,
            snippet: item.snippet,
            publishedAt: item.publishedAt,
            sourceTier: item.sourceTier,
            domain: new URL(item.url).hostname,
            query: item.query,
            searchProviders: item.retrievalProvider ? [item.retrievalProvider] : [],
          }));
          await store.saveCheckpoint({
            stage: "retrieval",
            status: saved.length ? "partial" : "failed",
            payload: saved.length ? {
              status: "partial",
              providers: [{
                provider: "checkpoint-recovery",
                attempted: true,
                succeeded: true,
                queryCount: 0,
                resultCount: saved.length,
                status: "partial",
                partialFailure: true,
                coverageCapability: "coarse",
                errorCode: "retrieval_interrupted_after_candidates_saved",
              }],
              results: recoveredResults,
              fetchedAt: new Date().toISOString(),
            } : { status: "failed", providers: [], results: [] },
            diagnostics: {
              candidateCount: saved.length,
              failureCode: error instanceof Error && error.message === "INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED"
                ? "candidate_persistence_failed"
                : "retrieval_failed",
            },
          });
        } catch {
          // The original failure is more useful; the worker will retain the
          // run-level safe error even when checkpoint storage itself is down.
        }
        throw error;
      }
      const allCandidates = retrieval.results
        .map((item) => fromSearchItem(item, item.searchProviders?.[0] || null))
        .filter((item): item is IntelligencePipelineEvidence => !!item)
        .map((item) => markPublicationWindowExclusion(item, coverage.start, coverage.end));
      await store.upsertEvidence(allCandidates);
      const initialWindow = scopeEvidenceToPublicationWindow(allCandidates, coverage.start, coverage.end);
      await store.saveCheckpoint({
        stage: "retrieval",
        status: retrieval.status === "success" ? "completed" : retrieval.status === "partial" ? "partial" : "failed",
        payload: { ...retrieval },
        diagnostics: {
          queryCount: plannedQueries.length,
          candidateCount: allCandidates.length,
          publicationWindow: initialWindow.audit,
        },
      });
    }
  }

  if (!retrieval) throw new Error("INTELLIGENCE_PIPELINE_RETRIEVAL_MISSING");

  let persistedEvidence = await store.listEvidence();
  let publicationWindow = scopeEvidenceToPublicationWindow(persistedEvidence, coverage.start, coverage.end);
  let evidence = publicationWindow.eligible;
  const evidenceCheckpoint = await store.loadCheckpoint("evidence");
  if (!evidenceCheckpoint || evidenceCheckpoint.status !== "completed") {
    const acquired = await acquireEvidenceWithBackfill(
      evidence,
      input,
      store,
      dependencies.acquireEvidence || acquireEvidence,
      coverage,
    );
    persistedEvidence = await store.listEvidence();
    publicationWindow = scopeEvidenceToPublicationWindow(persistedEvidence, coverage.start, coverage.end);
    evidence = publicationWindow.eligible;
    const full = evidence.filter((item) => item.evidenceStatus === "full").length;
    const partial = evidence.filter((item) => item.evidenceStatus === "partial").length;
    const unavailable = evidence.filter((item) => item.evidenceStatus === "unavailable").length;
    await store.saveCheckpoint({
      stage: "evidence",
      status: "completed",
      payload: { attempted: acquired.attemptedIds.length, full, partial, unavailable },
      diagnostics: {
        candidateCount: persistedEvidence.length,
        publicationWindow: publicationWindow.audit,
        attemptLimit: MAX_EVIDENCE_ATTEMPTS,
        targetUsable: TARGET_USABLE_EVIDENCE,
        candidatePoolExhausted: evidence.every((item) => item.evidenceStatus !== null),
      },
    });
  } else {
    // A checkpoint created by an older worker may already contain fetched
    // sources whose publication dates are outside this run. Re-scope every
    // resume without mutating or deleting the durable evidence rows.
    persistedEvidence = await store.listEvidence();
    publicationWindow = scopeEvidenceToPublicationWindow(persistedEvidence, coverage.start, coverage.end);
    evidence = publicationWindow.eligible;
  }

  const usableEvidence = evidence.filter((item) => item.evidenceStatus === "full" || item.evidenceStatus === "partial");
  if (!usableEvidence.length) {
    const brief = insufficientEvidenceBrief(
      input,
      coverage.start,
      coverage.end,
      generatedAt.toISOString(),
      retrieval,
      evidence,
      generationProvider,
      publicationWindow.audit,
    );
    await store.saveCheckpoint({
      stage: "brief",
      status: "partial",
      payload: { brief },
      diagnostics: { reason: "insufficient_evidence", publicationWindow: publicationWindow.audit },
    });
    return brief;
  }

  let factsCheckpoint = await store.loadCheckpoint("facts");
  let bundle: FactBundle;
  if (factsCheckpoint?.status === "completed" || factsCheckpoint?.status === "partial") {
    const raw = JSON.stringify(factsCheckpoint.payload.factBundle);
    bundle = parseFactBundle(raw, new Map(usableEvidence.map((item) => [item.itemKey, item])), input.maxItems, true);
  } else {
    if (factsCheckpoint?.status === "running" || factsCheckpoint?.status === "uncertain") {
      throw new Error("INTELLIGENCE_PIPELINE_FACTS_UNCERTAIN");
    }
    if (factsCheckpoint?.status === "failed") {
      throw new Error(factsCheckpoint.diagnostics.externalCallCompleted === true
        ? "INTELLIGENCE_PIPELINE_FACTS_COMPLETED_INVALID"
        : "INTELLIGENCE_PIPELINE_FACTS_FAILED_NO_REPLAY");
    }
    if (!generationProvider.generate) throw new Error("INTELLIGENCE_PIPELINE_GENERATION_UNAVAILABLE");
    await store.saveCheckpoint({ stage: "facts", status: "running", payload: {}, diagnostics: {} });
    let externalCallCompleted = false;
    const streamedState: { text: string; rowCount: number; bundle: FactBundle | null } = {
      text: "",
      rowCount: 0,
      bundle: null,
    };
    const evidenceById = new Map(usableEvidence.map((item) => [item.itemKey, item]));
    const persistCompleteStreamedFacts = async (chunk: string) => {
      streamedState.text += chunk;
      if (streamedState.text.length > 48_000) throw new Error("INTELLIGENCE_PIPELINE_OUTPUT_LIMIT");
      const rows = completeStreamedFactRows(streamedState.text);
      if (rows.length <= streamedState.rowCount) return;
      streamedState.rowCount = rows.length;
      streamedState.bundle = parseFactBundle(JSON.stringify({ facts: rows, g: [], c: "low" }), evidenceById, input.maxItems);
      await store.saveCheckpoint({
        stage: "facts",
        status: "running",
        payload: { factBundle: streamedState.bundle },
        diagnostics: {
          generationCalls: 1,
          streamedCompleteItems: streamedState.rowCount,
          acceptedItems: streamedState.bundle.validation.acceptedItems,
          rejectedItems: streamedState.bundle.validation.rejectedItems,
          externalCallCompleted: false,
          automaticReplayAllowed: false,
        },
      });
    };
    try {
      const raw = await generationProvider.generate({
        system: "你是股权投资情报分析员。只输出紧凑 JSON；只能基于已持久化证据，不搜索、不访问 URL、不虚构事实或日期。",
        prompt: factPrompt(input, coverage.start, coverage.end, usableEvidence),
        phase: "pipeline-fact-extraction",
        responseFormat: generationProvider.id === "deepseek" ? "json_object" : undefined,
        maxOutputTokens: PIPELINE_GENERATION_MAX_OUTPUT_TOKENS,
        onOutputChunk: persistCompleteStreamedFacts,
      });
      externalCallCompleted = true;
      bundle = parseFactBundle(raw, evidenceById, input.maxItems);
      await store.saveCheckpoint({
        stage: "facts",
        status: bundle.validation.rejectedItems ? "partial" : "completed",
        payload: { factBundle: bundle },
        diagnostics: {
          generationCalls: 1,
          totalItems: bundle.validation.totalItems,
          acceptedItems: bundle.validation.acceptedItems,
          rejectedItems: bundle.validation.rejectedItems,
          rejectionReasons: bundle.validation.rejectionReasons,
          sanitizedFields: bundle.validation.sanitizedFields,
        },
      });
    } catch (error) {
      const providerMarkedCompleted = (error as Error & { externalCallCompleted?: boolean })?.externalCallCompleted === true;
      const settledCompleted = externalCallCompleted || providerMarkedCompleted;
      const truncated = /AI completion truncated|finish_reason=length|truncated/i.test(error instanceof Error ? error.message : String(error));
      if (settledCompleted && truncated && streamedState.bundle && streamedState.bundle.facts.length > 0) {
        bundle = {
          ...streamedState.bundle,
          unresolvedGaps: [
            ...streamedState.bundle.unresolvedGaps,
            "模型输出达到长度上限；仅保留已完整接收且通过事实级证据校验的事项",
          ].slice(0, 12),
          confidence: "low",
        };
        await store.saveCheckpoint({
          stage: "facts",
          status: "partial",
          payload: { factBundle: bundle },
          diagnostics: {
            generationCalls: 1,
            code: "generation_output_truncated_partial_recovered",
            streamedCompleteItems: streamedState.rowCount,
            acceptedItems: bundle.validation.acceptedItems,
            rejectedItems: bundle.validation.rejectedItems,
            externalCallCompleted: true,
            automaticReplayAllowed: false,
          },
        });
      } else {
        await store.saveCheckpoint({
          stage: "facts",
          status: settledCompleted ? "failed" : "uncertain",
          payload: streamedState.bundle ? { factBundle: streamedState.bundle } : {},
          diagnostics: {
            code: error instanceof Error ? error.message.slice(0, 120) : "unknown",
            streamedCompleteItems: streamedState.rowCount,
            acceptedItems: streamedState.bundle?.validation.acceptedItems ?? 0,
            rejectedItems: streamedState.bundle?.validation.rejectedItems ?? 0,
            externalCallCompleted: settledCompleted,
            automaticReplayAllowed: false,
          },
        }).catch(() => {});
        throw error;
      }
    }
  }

  const brief = buildBrief(
    input,
    coverage.start,
    coverage.end,
    generatedAt.toISOString(),
    retrieval,
    evidence,
    bundle,
    generationProvider,
    publicationWindow.audit,
  );
  const finalizedFactsCheckpoint = await store.loadCheckpoint("facts");
  await store.saveCheckpoint({
    stage: "brief",
    status: finalizedFactsCheckpoint?.status === "partial" || bundle.validation.rejectedItems ? "partial" : "completed",
    payload: { brief },
    diagnostics: { itemCount: brief.itemCount, rejectedItems: bundle.validation.rejectedItems },
  });
  return brief;
}
