export type RunStatus = "queued" | "running" | "succeeded" | "partial" | "no_new_items" | "failed" | "blocked" | "cancelled";

export interface IntelligenceTopic {
  id: string;
  name: string;
  topics: string[];
  entities: string[];
  keywords: string[];
  regions: string[];
  include_requirements: string[];
  exclude_requirements: string[];
  max_items: number;
  lookback_period: { kind: "days" | "custom"; value?: number; start?: string; end?: string };
  output_instructions: string;
  execution_mode: "manual" | "scheduled";
  schedule_config: { frequency: "daily" | "weekly"; weekdays?: number[]; time: string; timezone: string } | null;
  is_active: boolean;
  original_request?: string | null;
  config_version: number;
  event_types: string[];
  source_policy: Record<string, unknown>;
  next_run_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_run_id?: string | null;
  last_run_status?: RunStatus | null;
  last_run_started_at?: string | null;
  last_run_finished_at?: string | null;
  last_retrieval_status?: string | null;
  last_run_error_code?: string | null;
  last_run_error?: string | null;
  latest_brief_id?: string | null;
  last_generated_at?: string | null;
  latest_coverage_start?: string | null;
  latest_coverage_end?: string | null;
  latest_item_count?: number | null;
  latest_brief_metadata?: Record<string, unknown> | null;
}

export interface IntelligenceRun {
  id: string;
  task_id: string;
  trigger_type: "manual" | "scheduled" | "catchup" | "retry";
  status: RunStatus;
  config_version: number;
  config_snapshot?: Record<string, unknown>;
  scheduled_for: string | null;
  coverage_start: string;
  coverage_end: string;
  attempt_count: number;
  attempt_history?: unknown[];
  started_at: string | null;
  finished_at: string | null;
  retrieval_status: "success" | "partial" | "failed" | "unknown" | null;
  provider_diagnostics: Array<{ provider?: string; attempted?: boolean; succeeded?: boolean; resultCount?: number; errorCode?: string }>;
  evidence_summary: Record<string, unknown>;
  usage?: Record<string, unknown>;
  external_cost_authorization?: { deepSeekSearch?: boolean; deepSeekFetch?: boolean };
  error_code: string | null;
  error_message_safe: string | null;
  created_at: string;
  updated_at: string;
  brief_id?: string | null;
  checkpoint_stage?: "understanding" | "retrieval" | "evidence" | "facts" | "brief" | null;
  checkpoint_status?: "running" | "completed" | "partial" | "failed" | "uncertain" | null;
  requires_fresh_authorization?: boolean;
}

export interface IntelligenceBrief {
  id: string;
  task_id: string;
  task_name: string;
  coverage_start: string;
  coverage_end: string;
  generated_at: string;
  item_count: number;
  important_facts: IntelligenceBriefItem[];
  trend_signals: IntelligenceBriefItem[];
  other_items: IntelligenceBriefItem[];
  source_list: Array<{ source?: string; url?: string | null; publishedAt?: string | null; sourceTier?: string; origin?: string }>;
  metadata: Record<string, unknown>;
  run_id?: string | null;
  schema_version?: number;
  run_status?: RunStatus | null;
  trigger_type?: string | null;
  error_code?: string | null;
  error_message_safe?: string | null;
}

export interface IntelligenceBriefItem {
  id: string;
  title?: string;
  content?: string;
  summary?: string;
  investmentNote?: string;
  relevanceReason?: string;
  source?: string;
  sourceUrl?: string | null;
  sourceUrls?: string[];
  sourceTier?: string;
  publishedAt?: string;
  eventDate?: string;
  eventTimeText?: string;
  eventDateSupport?: "evidence";
  discoveredAt?: string;
  fetchedAt?: string;
  eventType?: string;
  evidenceStatus?: string;
  supportLevel?: string;
  timeUnconfirmed?: boolean;
  isClue?: boolean;
  followUpReason?: string;
  conflicts?: Array<{
    type: "financing-round";
    reason: "same-entity-near-date-different-round";
    entity: string;
    values: string[];
    relatedSourceUrls: string[];
  }>;
  importance?: string;
  relevance?: string;
}

export function intelligenceEventTimeLabel(item: Pick<IntelligenceBriefItem, "eventDate" | "eventTimeText">): string {
  if (item.eventDate) {
    const parsed = new Date(item.eventDate);
    return Number.isFinite(parsed.getTime()) ? `事件日 ${parsed.toLocaleDateString("zh-CN")}` : "事件日未确认";
  }
  return item.eventTimeText ? `事件时间 ${item.eventTimeText}（未精确到日）` : "事件日未确认";
}

export interface SchedulerStatus {
  healthy: boolean;
  lastHeartbeatAt: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
}

export function topicPayload(topic: IntelligenceTopic, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: topic.name,
    topics: topic.topics,
    entities: topic.entities,
    keywords: topic.keywords,
    regions: topic.regions,
    includeRequirements: topic.include_requirements,
    excludeRequirements: topic.exclude_requirements,
    maxItems: topic.max_items,
    lookbackPeriod: topic.lookback_period,
    outputInstructions: topic.output_instructions,
    executionMode: topic.execution_mode,
    scheduleConfig: topic.schedule_config,
    isActive: topic.is_active,
    eventTypes: topic.event_types,
    sourcePolicy: topic.source_policy,
    ...overrides,
  };
}
