import assert from "node:assert/strict";

import { AICompletionTruncatedError } from "@/lib/ai";
import type { EvidenceAcquirer, EvidenceCandidate } from "@/lib/intelligenceEvidence";
import { IntelligenceRetrievalOrchestrator, type IntelligenceProvider, type RetrievalRequest, type RetrievalResult } from "@/lib/intelligenceProvider";
import { DeepSeekSearchFetchBudget, createDeepSeekSearchFetchAdapter } from "@/lib/intelligenceDeepSeekAdapter";
import {
  runIntelligencePipeline,
  type IntelligencePipelineCheckpoint,
  type IntelligencePipelineEvidence,
  type IntelligencePipelineStage,
  type IntelligencePipelineStore,
} from "@/lib/intelligencePipeline";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";

class MemoryStore implements IntelligencePipelineStore {
  readonly checkpoints = new Map<IntelligencePipelineStage, IntelligencePipelineCheckpoint>();
  readonly evidence = new Map<string, IntelligencePipelineEvidence>();

  async loadCheckpoint(stage: IntelligencePipelineStage) {
    return this.checkpoints.get(stage) ?? null;
  }

  async saveCheckpoint(checkpoint: Omit<IntelligencePipelineCheckpoint, "attempt"> & { attempt?: number }) {
    const existing = this.checkpoints.get(checkpoint.stage);
    this.checkpoints.set(checkpoint.stage, {
      ...checkpoint,
      attempt: checkpoint.attempt ?? existing?.attempt ?? 1,
    });
  }

  async upsertEvidence(items: IntelligencePipelineEvidence[]) {
    for (const item of items) {
      const existing = this.evidence.get(item.itemKey);
      this.evidence.set(item.itemKey, { ...existing, ...item });
    }
  }

  async listEvidence() {
    return [...this.evidence.values()];
  }
}

const input: IntelligenceTaskInput = {
  name: "机器人企业资本动态",
  originalRequest: "收集宇树科技 2024 年融资动态，并区分事实和判断",
  topics: ["机器人"],
  entities: ["宇树科技"],
  keywords: ["融资"],
  regions: ["中国"],
  includeRequirements: ["融资轮次", "投资方"],
  excludeRequirements: [],
  maxItems: 10,
  lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" },
  outputInstructions: "引用可核验来源",
  executionMode: "manual",
  scheduleConfig: null,
  isActive: true,
  eventTypes: ["融资"],
  sourcePolicy: {},
};

const coverage = { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z") };
const generatedAt = new Date("2026-11-04T00:00:00.000Z");

function searchItem(url = "https://example.com/unitree-financing"): WebSearchItem {
  return {
    title: "宇树科技完成 B2 轮融资",
    url,
    siteName: "示例权威来源",
    snippet: "宇树科技完成 B2 轮融资。",
    publishedAt: "2024-02-02T00:00:00.000Z",
    sourceTier: "A",
    domain: "example.com",
    query: "宇树科技 2024 融资",
    searchProviders: ["fixture-search"],
  };
}

function retrievalResult(results: WebSearchItem[], status: RetrievalResult["status"] = "success"): RetrievalResult {
  return {
    status,
    results,
    providers: [{
      provider: "fixture-search",
      attempted: true,
      succeeded: status !== "failed",
      queryCount: 1,
      resultCount: results.length,
      status,
      coverageCapability: "coarse",
    }],
    fetchedAt: generatedAt.toISOString(),
  };
}

const acquireFull: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => {
  const updated = candidates.map((candidate) => Object.assign(candidate, {
    content: "宇树科技于2024年2月1日完成B2轮融资。该信息来自公开报道。",
    evidenceStatus: "full" as const,
    evidencePublishedAt: "2024-02-02T00:00:00.000Z",
  }));
  return { candidates: updated, stats: { attempted: updated.length, full: updated.length, partial: 0, unavailable: 0 } };
};

function provider(options: { invalid?: boolean; unknownEvidence?: boolean } = {}) {
  let calls = 0;
  let lastPrompt = "";
  const value: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      calls += 1;
      lastPrompt = request.prompt;
      if (options.invalid) return "not-json";
      const evidenceId = options.unknownEvidence
        ? "missing-evidence"
        : request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId, "the fact prompt must contain a persisted evidence id");
      return JSON.stringify({
        overview: "已找到一项可核验融资动态。",
        facts: [{
          headline: "宇树科技完成 B2 轮融资",
          summary: "公开报道显示宇树科技完成 B2 轮融资。",
          assessment: "该事项可作为资本活跃度线索。",
          eventDate: "2024-02-01",
          eventTimeText: null,
          eventType: "融资",
          entities: ["宇树科技"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "直接对应融资主题",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: ["公开材料未披露完整金额"],
        confidence: "medium",
      });
    },
  };
  return { value, get calls() { return calls; }, get lastPrompt() { return lastPrompt; } };
}

function providerWithBundle(bundle: (evidenceId: string) => Record<string, unknown>) {
  let lastPrompt = "";
  const value: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      lastPrompt = request.prompt;
      const evidenceId = request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId, "the fact prompt must contain a persisted evidence id");
      return JSON.stringify(bundle(evidenceId));
    },
  };
  return { value, get lastPrompt() { return lastPrompt; } };
}

async function successfulVerticalSlice() {
  const store = new MemoryStore();
  const generation = provider();
  let searches = 0;
  let evidenceCalls = 0;
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: {
      async retrieve(request: RetrievalRequest) {
        searches += 1;
        const result = retrievalResult([searchItem()]);
        await request.onBatch?.({ provider: "fixture-search", query: searchItem().query, results: result.results });
        return result;
      },
    },
    acquireEvidence: async (candidates, options) => {
      evidenceCalls += 1;
      return acquireFull(candidates, options);
    },
  });

  assert.equal(searches, 1);
  assert.equal(evidenceCalls, 1);
  assert.equal(generation.calls, 1);
  assert.match(generation.lastPrompt, /收集宇树科技 2024 年融资动态/);
  assert.equal(brief.itemCount, 1);
  assert.equal(brief.importantFacts[0]?.eventDate, "2024-02-01");
  assert.equal(brief.importantFacts[0]?.sourceUrl, "https://example.com/unitree-financing");
  assert.equal(store.checkpoints.get("brief")?.status, "completed");
  assert.equal((await store.listEvidence())[0]?.evidenceStatus, "full");

  // A completed pipeline is deterministic and does not search, fetch or generate again.
  const resumed = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => { throw new Error("retrieval must not replay"); } },
    acquireEvidence: async () => { throw new Error("evidence must not replay"); },
  });
  assert.equal(resumed.itemCount, 1);
  assert.equal(searches, 1);
  assert.equal(evidenceCalls, 1);
  assert.equal(generation.calls, 1);
}

async function coarseEmptyIsInsufficient() {
  const store = new MemoryStore();
  const generation = provider();
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([]) },
    acquireEvidence: acquireFull,
  });
  assert.equal(brief.itemCount, 0);
  assert.equal(brief.metadata.retrieval.coverageConclusion, "insufficient_evidence");
  assert.match(brief.metadata.overview, /不等于市场上没有/);
  assert.equal(generation.calls, 0);
}

async function candidatesSurviveInterruptedRetrieval() {
  const store = new MemoryStore();
  const generation = provider();
  let searches = 0;
  await assert.rejects(
    runIntelligencePipeline(input, coverage, generatedAt, {
      store,
      generationProvider: generation.value,
      retrieval: {
        async retrieve(request: RetrievalRequest) {
          searches += 1;
          await request.onBatch?.({ provider: "fixture-search", query: searchItem().query, results: [searchItem()] });
          throw new Error("simulated worker death after search checkpoint");
        },
      },
      acquireEvidence: acquireFull,
    }),
    /simulated worker death/,
  );
  assert.equal((await store.listEvidence()).length, 1);
  assert.equal(store.checkpoints.get("retrieval")?.status, "partial", "已保存候选的中断必须显示部分完成，而不是空结果或仍在运行");

  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => { searches += 1; throw new Error("search replayed"); } },
    acquireEvidence: acquireFull,
  });
  assert.equal(searches, 1);
  assert.equal(brief.itemCount, 1);
  assert.equal(brief.metadata.retrieval.status, "partial");
}

async function completedInvalidOutputNeverAutoReplays() {
  const store = new MemoryStore();
  const generation = provider({ unknownEvidence: true });
  const dependencies = {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem()]) },
    acquireEvidence: acquireFull,
  };
  const partial = await runIntelligencePipeline(input, coverage, generatedAt, dependencies);
  assert.equal(generation.calls, 1);
  assert.equal(partial.importantFacts.length, 0, "an invalid fact must be isolated rather than published as fact");
  assert.equal(partial.itemCount, 1, "relevant persisted evidence may still produce one deliberately sparse clue");
  assert.equal(partial.otherItems[0]?.isClue, true);
  assert.match(partial.otherItems[0]?.title || "", /融资相关线索待核验/);
  assert.doesNotMatch(JSON.stringify(partial), /missing-evidence/);
  assert.equal(partial.sourceList.length, 1, "all-invalid output must still retain the real source set");
  assert.equal(store.checkpoints.get("facts")?.status, "partial");
  assert.equal(store.checkpoints.get("facts")?.diagnostics.acceptedItems, 0);
  assert.equal(store.checkpoints.get("facts")?.diagnostics.rejectedItems, 1);
  assert.deepEqual(store.checkpoints.get("facts")?.diagnostics.rejectionReasons, { unknown_evidence: 1 });
  const resumed = await runIntelligencePipeline(input, coverage, generatedAt, dependencies);
  assert.equal(resumed.itemCount, 1);
  assert.equal(resumed.importantFacts.length, 0);
  assert.equal(generation.calls, 1, "a completed item-level validation must not replay the paid call");
  assert.equal((await store.listEvidence()).length, 1, "evidence remains available for diagnosis or explicit recovery");

  const malformedStore = new MemoryStore();
  const malformed = provider({ invalid: true });
  const malformedDependencies = {
    store: malformedStore,
    generationProvider: malformed.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/malformed")]) },
    acquireEvidence: acquireFull,
  };
  await assert.rejects(runIntelligencePipeline(input, coverage, generatedAt, malformedDependencies), /OUTPUT_JSON_INVALID/);
  assert.equal(malformed.calls, 1);
  assert.equal(malformedStore.checkpoints.get("facts")?.status, "failed", "incomplete top-level JSON must never be published");
  await assert.rejects(runIntelligencePipeline(input, coverage, generatedAt, malformedDependencies), /FACTS_COMPLETED_INVALID/);
  assert.equal(malformed.calls, 1, "completed malformed JSON must not trigger another paid call");
}

async function oneInvalidFactDoesNotDiscardValidEvidenceBoundFact() {
  const store = new MemoryStore();
  let calls = 0;
  const generation: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      calls += 1;
      const evidenceId = request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId);
      return JSON.stringify({
        overview: "一项有效，一项引用未知来源。",
        facts: [
          {
            headline: "宇树科技完成 B2 轮融资",
            summary: "公开报道显示宇树科技完成 B2 轮融资。",
            assessment: "融资事项值得继续核验。",
            eventDate: null,
            eventTimeText: "2024年2月",
            eventType: "融资",
            entities: ["宇树科技"],
            status: "confirmed",
            relevance: "high",
            relevanceReason: "直接对应融资主题",
            evidenceIds: [evidenceId],
          },
          {
            headline: "未经来源支持的另一轮融资",
            summary: "这条内容没有对应已保存的证据。",
            assessment: "不得发布。",
            eventDate: "2024-99-99",
            eventTimeText: null,
            eventType: "融资",
            entities: ["宇树科技"],
            status: "confirmed",
            relevance: "high",
            relevanceReason: "无有效证据",
            evidenceIds: ["unknown-source"],
          },
        ],
        unresolvedGaps: [],
        confidence: "medium",
      });
    },
  };
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/mixed")]) },
    acquireEvidence: acquireFull,
  });
  assert.equal(calls, 1);
  assert.equal(brief.itemCount, 1, "a valid evidence-bound fact must survive another item's schema failure");
  assert.match(brief.importantFacts[0]?.title || "", /B2 轮融资/);
  assert.equal(brief.metadata.research?.mode, "pipeline-v2");
  if (brief.metadata.research?.mode !== "pipeline-v2") throw new Error("expected pipeline-v2 research metadata");
  assert.equal(brief.metadata.research.validation?.acceptedItems, 1);
  assert.equal(brief.metadata.research.validation?.rejectedItems, 1);
  assert.deepEqual(brief.metadata.research.validation?.rejectionReasons, { unknown_evidence: 1 });
  assert.equal(store.checkpoints.get("facts")?.status, "partial");
  assert.equal(store.checkpoints.get("brief")?.status, "partial");
  assert.doesNotMatch(JSON.stringify(brief), /未经来源支持的另一轮融资|2024-99-99|unknown-source/);
}

async function compactStreamingOutputPersistsCompleteFactsAndNeverAutoReplays() {
  const compactFact = (evidenceId: string) => ({
    h: "宇树科技完成 B2 轮融资",
    s: "公开报道显示宇树科技完成 B2 轮融资。",
    a: "该事项反映资本活跃度，完整金额仍需继续核验。",
    d: null,
    t: "融资",
    e: ["宇树科技"],
    st: "confirmed",
    r: "high",
    rr: "直接对应融资主题",
    ids: [evidenceId],
  });
  const longEvidence: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: `宇树科技完成B2轮融资。${"与融资无关的背景资料。".repeat(1_200)}`,
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-02-02T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });

  const successStore = new MemoryStore();
  let successCalls = 0;
  const compactSuccess: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      successCalls += 1;
      assert.equal(request.responseFormat, "json_object");
      assert.equal(request.maxOutputTokens, 8_192);
      assert.ok(request.prompt.length < 12_000, "prompt must use relevant excerpts rather than repeat long pages");
      assert.doesNotMatch(request.prompt, /"url":/);
      assert.ok((request.prompt.match(/与融资无关的背景资料/g) || []).length < 10);
      const evidenceIds = [...request.prompt.matchAll(/"evidenceId":"([^"]+)"/g)].map((match) => match[1]!);
      assert.equal(evidenceIds.length, 2);
      const raw = JSON.stringify({ facts: evidenceIds.map(compactFact), g: ["完整金额仍需核验"], c: "medium" });
      for (let offset = 0; offset < raw.length; offset += 19) await request.onOutputChunk?.(raw.slice(offset, offset + 19));
      return raw;
    },
  };
  const successBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: successStore,
    generationProvider: compactSuccess,
    retrieval: { retrieve: async () => retrievalResult([
      searchItem("https://example.com/compact-success-a"),
      searchItem("https://example.com/compact-success-b"),
    ]) },
    acquireEvidence: longEvidence,
  });
  assert.equal(successBrief.itemCount, 1);
  assert.equal(successCalls, 1);
  assert.equal(successStore.checkpoints.get("facts")?.status, "completed");
  assert.equal(successStore.checkpoints.get("facts")?.payload.factBundle && (successStore.checkpoints.get("facts")!.payload.factBundle as { validation: { sanitizedFields: Record<string, number> } }).validation.sanitizedFields.duplicate_event_merged, 1);
  assert.equal(successBrief.importantFacts[0]?.sourceUrls?.length, 2, "duplicate streamed rows must merge their evidence rather than publish duplicate IDs");

  const sameUrlStore = new MemoryStore();
  const sameUrlDifferentEvents: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      const evidenceId = request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId);
      return JSON.stringify({ facts: [
        compactFact(evidenceId),
        { ...compactFact(evidenceId), h: "宇树科技收购乙公司", s: "公开报道显示宇树科技完成对乙公司的收购。", a: "该交易可能影响产业布局。", t: "收购", e: ["宇树科技", "乙公司"] },
      ], g: [], c: "medium" });
    },
  };
  const sameUrlBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: sameUrlStore,
    generationProvider: sameUrlDifferentEvents,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/two-events-one-source")]) },
    acquireEvidence: async <T extends EvidenceCandidate>(candidates: T[]) => ({
      candidates: candidates.map((candidate) => Object.assign(candidate, {
        content: "宇树科技完成B2轮融资。宇树科技完成对乙公司的收购。",
        evidenceStatus: "full" as const,
      })),
      stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
    }),
  });
  assert.equal(sameUrlBrief.itemCount, 2, "one source may describe two distinct event types and must not be collapsed by URL");
  assert.notEqual(sameUrlBrief.importantFacts[0]?.id, sameUrlBrief.importantFacts[1]?.id);

  const paraphraseStore = new MemoryStore();
  const paraphrasedSources: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      const evidenceIds = [...request.prompt.matchAll(/"evidenceId":"([^"]+)"/g)].map((match) => match[1]!);
      assert.equal(evidenceIds.length, 2);
      return JSON.stringify({ facts: [
        { ...compactFact(evidenceIds[0]!), d: "2024-02-01" },
        { ...compactFact(evidenceIds[1]!), h: "宇树科技 B2 轮融资落地", s: "宇树科技的 B2 轮融资已经落地。", d: "2024-02-01" },
      ], g: [], c: "high" });
    },
  };
  const paraphraseBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: paraphraseStore,
    generationProvider: paraphrasedSources,
    retrieval: { retrieve: async () => retrievalResult([
      searchItem("https://example.com/paraphrase-a"),
      searchItem("https://example.com/paraphrase-b"),
    ]) },
    acquireEvidence: async <T extends EvidenceCandidate>(candidates: T[]) => ({
      candidates: candidates.map((candidate) => Object.assign(candidate, {
        content: "宇树科技于2024年2月1日完成B2轮融资。",
        evidenceStatus: "full" as const,
      })),
      stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
    }),
  });
  assert.equal(paraphraseBrief.itemCount, 1, "same dated round phrased differently must merge at the established event-identity gate");
  assert.equal(paraphraseBrief.importantFacts[0]?.sourceUrls?.length, 2);

  const truncatedStore = new MemoryStore();
  let truncatedCalls = 0;
  const compactTruncated: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      truncatedCalls += 1;
      const evidenceId = request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId);
      const prefix = `{"facts":[${JSON.stringify(compactFact(evidenceId))},{"h":"未完成的第二条`;
      for (let offset = 0; offset < prefix.length; offset += 17) {
        await request.onOutputChunk?.(prefix.slice(offset, offset + 17));
      }
      const error = new AICompletionTruncatedError() as AICompletionTruncatedError & { externalCallCompleted?: boolean };
      error.externalCallCompleted = true;
      throw error;
    },
  };
  const partialBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: truncatedStore,
    generationProvider: compactTruncated,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/compact-truncated")]) },
    acquireEvidence: longEvidence,
  });
  assert.equal(partialBrief.itemCount, 1, "a fully closed and evidence-validated item must survive a later truncated tail");
  assert.equal(truncatedCalls, 1);
  assert.equal(truncatedStore.checkpoints.get("facts")?.status, "partial");
  assert.equal(truncatedStore.checkpoints.get("facts")?.diagnostics.externalCallCompleted, true);
  assert.equal(truncatedStore.checkpoints.get("facts")?.diagnostics.automaticReplayAllowed, false);
  assert.equal(truncatedStore.checkpoints.get("facts")?.diagnostics.acceptedItems, 1);
  assert.equal(truncatedStore.checkpoints.get("brief")?.status, "partial");
  assert.equal(partialBrief.metadata.research?.mode, "pipeline-v2");
  if (partialBrief.metadata.research?.mode !== "pipeline-v2") throw new Error("expected pipeline-v2 research metadata");
  assert.match(String(partialBrief.metadata.research.unresolvedGaps.join(" ")), /长度上限/);
  const resumed = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: truncatedStore,
    generationProvider: compactTruncated,
    retrieval: { retrieve: async () => { throw new Error("retrieval must not replay"); } },
    acquireEvidence: async () => { throw new Error("evidence must not replay"); },
  });
  assert.equal(resumed.itemCount, 1);
  assert.equal(truncatedCalls, 1, "completed truncated call must recover from checkpoint without another provider request");

  const noCompleteStore = new MemoryStore();
  let noCompleteCalls = 0;
  const noComplete: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      noCompleteCalls += 1;
      await request.onOutputChunk?.('{"facts":[{"h":"未完成');
      const error = new AICompletionTruncatedError() as AICompletionTruncatedError & { externalCallCompleted?: boolean };
      error.externalCallCompleted = true;
      throw error;
    },
  };
  const noCompleteDependencies = {
    store: noCompleteStore,
    generationProvider: noComplete,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/no-complete-fact")]) },
    acquireEvidence: longEvidence,
  };
  await assert.rejects(runIntelligencePipeline(input, coverage, generatedAt, noCompleteDependencies), /AI completion truncated/);
  assert.equal(noCompleteStore.checkpoints.get("facts")?.status, "failed");
  assert.equal(noCompleteStore.checkpoints.get("facts")?.diagnostics.externalCallCompleted, true);
  assert.equal(noCompleteStore.checkpoints.get("facts")?.diagnostics.automaticReplayAllowed, false);
  await assert.rejects(runIntelligencePipeline(input, coverage, generatedAt, noCompleteDependencies), /FACTS_COMPLETED_INVALID/);
  assert.equal(noCompleteCalls, 1, "no complete validated item still fails closed and cannot replay the paid call");
}

async function eventDateMustBelongToTheSameSubjectAndEvent() {
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "甲公司和宇树科技均有融资动态。",
    facts: [{
      headline: "宇树科技于2024年1月22日完成 B2 轮融资",
      summary: "宇树科技于2024年1月22日完成 B2 轮融资。",
      assessment: "该融资值得继续跟踪。",
      eventDate: "2024-01-22",
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "直接对应主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "medium",
  }));
  const acquireMixed: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "甲公司于2024年1月22日完成B2轮融资。宇树科技完成B2轮融资，但公开材料未披露事件日期。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-02-02T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem()]) },
    acquireEvidence: acquireMixed,
  });
  assert.equal(brief.itemCount, 1, "the supported Unitree financing fact should remain");
  assert.equal(brief.importantFacts[0]?.eventDate, undefined, "another company's date must not be borrowed");
  assert.doesNotMatch(`${brief.importantFacts[0]?.title} ${brief.importantFacts[0]?.summary}`, /2024\D*1\D*22|1月22日/);
}

async function unrelatedEvidenceCannotPublishAndOverviewCannotClaimAbsence() {
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "本期未发生任何并购或融资。",
    facts: [{
      headline: "宇树科技完成 B2 轮融资",
      summary: "宇树科技完成 B2 轮融资。",
      assessment: "资本活跃度提升。",
      eventDate: null,
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "直接对应主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const acquireUnrelated: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "甲公司于2024年1月22日完成B2轮融资。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-01-23T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem()]) },
    acquireEvidence: acquireUnrelated,
  });
  assert.equal(brief.itemCount, 0);
  assert.match(String(brief.metadata.overview), /不代表市场上没有/);
  assert.doesNotMatch(String(brief.metadata.overview), /未发生任何/);
}

async function fullTaskSemanticsReachQueriesCheckpointAndPrompt() {
  const store = new MemoryStore();
  const generation = provider();
  const scopedInput: IntelligenceTaskInput = {
    ...input,
    originalRequest: "收集中国上海机器人企业融资，优先监管官网，并结合我关注的项目判断",
    keywords: ["融资", "股权投资"],
    regions: ["中国", "上海"],
    includeRequirements: ["融资轮次", "投资方"],
    maxItems: 1,
    sourcePolicy: { preferredDomains: ["gov.cn"], requirePrimaryWhenAvailable: true },
    personalizationPrompt: "重点关注与项目组合存在供应链协同的事项",
    personalizationMeta: { profileUsed: true, projectIds: ["project-fixture"], judgmentCount: 2 },
  };
  let observedQueries: string[] = [];
  const brief = await runIntelligencePipeline(scopedInput, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    maxSearchQueries: 2,
    retrieval: {
      async retrieve(request) {
        observedQueries = request.queries ?? [];
        return retrievalResult([searchItem()]);
      },
    },
    acquireEvidence: acquireFull,
  });
  assert.equal(brief.itemCount, 1);
  assert.equal(observedQueries.length, 2);
  for (const query of observedQueries) {
    assert.match(query, /中国/);
    assert.match(query, /上海/);
    assert.match(query, /股权投资/);
    assert.match(query, /投资方/);
  }
  const understanding = store.checkpoints.get("understanding")?.payload;
  assert.deepEqual(understanding?.regions, ["中国", "上海"]);
  assert.equal(understanding?.maxItems, 1);
  assert.deepEqual(understanding?.sourcePolicy, scopedInput.sourcePolicy);
  assert.equal(understanding?.personalizationPrompt, scopedInput.personalizationPrompt);
  assert.match(generation.lastPrompt, /重点关注与项目组合存在供应链协同/);
  assert.match(generation.lastPrompt, /最多 1 条 facts/);
}

async function unsupportedAmountInvestorAndNegativeOverviewAreRejected() {
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "已确认融资，其他融资均不存在。",
    facts: [{
      headline: "宇树科技完成10亿元 B2轮融资，红杉资本领投",
      summary: "宇树科技完成10亿元 B2轮融资，由红杉资本领投。",
      assessment: "10亿元融资显著提升资金实力。",
      eventDate: "2024-02-01",
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技", "红杉资本"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "金额和投资方具有决策价值",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem()]) },
    acquireEvidence: acquireFull,
  });
  assert.equal(brief.importantFacts.length, 0, "unsupported amount and lead investor must not be published as a fact");
  assert.equal(brief.itemCount, 1, "the supported subject/action may remain as a sparse clue");
  assert.equal(brief.otherItems[0]?.isClue, true);
  assert.doesNotMatch(JSON.stringify(brief.otherItems[0]), /10亿元|红杉/);
  assert.doesNotMatch(String(brief.metadata.overview), /其他融资均不存在|10亿元|红杉/);
  assert.match(String(brief.metadata.overview), /形成 1 条事项/);
}

async function supportedAttributesRemainFactsAndUnknownActionsRemainClues() {
  const supportedStore = new MemoryStore();
  const supported = providerWithBundle((evidenceId) => ({
    overview: "模型概览不作为最终覆盖结论。",
    facts: [{
      headline: "宇树科技完成10亿元 B2轮融资，红杉资本领投",
      summary: "宇树科技完成10亿元 B2轮融资，由红杉资本领投。",
      assessment: "该融资规模值得持续跟踪。",
      eventDate: "2024-02-01",
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技", "红杉资本"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "直接对应主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const acquireSupported: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "宇树科技于2024年2月1日完成10亿元B2轮融资，由红杉资本领投。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-02-02T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const factBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: supportedStore,
    generationProvider: supported.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem()]) },
    acquireEvidence: acquireSupported,
  });
  assert.equal(factBrief.importantFacts.length, 1);
  assert.match(String(factBrief.metadata.overview), /基于已核验来源形成 1 条事项/);
  assert.doesNotMatch(String(factBrief.metadata.overview), /模型概览/);

  const unknownStore = new MemoryStore();
  const unknown = providerWithBundle((evidenceId) => ({
    overview: "宇树科技发生股权转让。",
    facts: [{
      headline: "宇树科技完成股权转让",
      summary: "宇树科技完成股权转让，受让方为乙公司。",
      assessment: "交易结构仍需后续核验。",
      eventDate: null,
      eventTimeText: "2024年5月",
      eventType: "股权转让",
      entities: ["宇树科技", "乙公司"],
      status: "confirmed",
      relevance: "medium",
      relevanceReason: "属于资本结构变化",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "medium",
  }));
  const acquireUnknown: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "宇树科技于2024年5月完成股权转让，受让方为乙公司。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-05-20T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const clueBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: unknownStore,
    generationProvider: unknown.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/equity-transfer")]) },
    acquireEvidence: acquireUnknown,
  });
  assert.equal(clueBrief.importantFacts.length, 0, "an unclassified action must not be promoted to confirmed fact");
  assert.equal(clueBrief.otherItems.length, 1, "an evidence-backed unknown action remains available as a clue");
  assert.equal(clueBrief.otherItems[0]?.isClue, true);
}

async function englishAmountsAndParticipantsRequireConcreteSourceSupport() {
  const englishInput: IntelligenceTaskInput = {
    ...input,
    name: "Unitree financing",
    originalRequest: "Track Unitree Robotics financing and investor participation",
    entities: ["Unitree Robotics"],
    keywords: ["financing"],
    regions: ["China"],
    eventTypes: ["financing"],
  };
  const englishSearch = searchItem("https://example.com/unitree-series-b");
  englishSearch.title = "Unitree Robotics raised Series B funding";
  englishSearch.snippet = "Unitree Robotics raised Series B funding.";
  const unsupportedAmounts = ["$100 million", "USD 100m", "RMB 500 million"];
  for (const amount of unsupportedAmounts) {
    const store = new MemoryStore();
    const generation = providerWithBundle((evidenceId) => ({
      overview: "All other investor participation was absent.",
      facts: [{
        headline: `Unitree Robotics raised ${amount} in Series B funding, led by Sequoia Capital`,
        summary: `Unitree Robotics raised ${amount}; Sequoia Capital led the round.`,
        assessment: "The financing is material for the company.",
        eventDate: null,
        eventTimeText: null,
        eventType: "financing",
        entities: ["Unitree Robotics", "Sequoia Capital"],
        status: "confirmed",
        relevance: "high",
        relevanceReason: "financing and investor participation",
        evidenceIds: [evidenceId],
      }],
      unresolvedGaps: [],
      confidence: "high",
    }));
    const acquireWithoutAttributes: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
      candidates: candidates.map((candidate) => Object.assign(candidate, {
        content: "Unitree Robotics raised Series B funding in 2024. The amount and investors were not disclosed.",
        evidenceStatus: "full" as const,
        evidencePublishedAt: "2024-05-20T00:00:00.000Z",
      })),
      stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
    });
    const brief = await runIntelligencePipeline(englishInput, coverage, generatedAt, {
      store,
      generationProvider: generation.value,
      retrieval: { retrieve: async () => retrievalResult([englishSearch]) },
      acquireEvidence: acquireWithoutAttributes,
    });
    assert.equal(brief.itemCount, 0, `${amount} and Sequoia must not survive without source support`);
    assert.doesNotMatch(JSON.stringify(brief), /Sequoia Capital|All other investor participation was absent|100 million|100m|500 million/);
  }

  const supportedStore = new MemoryStore();
  const supported = providerWithBundle((evidenceId) => ({
    overview: "Model wording is not the final coverage statement.",
    facts: [{
      headline: "Unitree Robotics raised $100 million in Series B funding, led by Sequoia Capital",
      summary: "Unitree Robotics raised $100 million; Sequoia Capital led the round.",
      assessment: "The financing is material for the company.",
      eventDate: null,
      eventTimeText: null,
      eventType: "financing",
      entities: ["Unitree Robotics", "Sequoia Capital"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "financing and investor participation",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "medium",
  }));
  const acquireWithAttributes: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "Unitree Robotics raised USD 100m in Series B funding, led by Sequoia Capital.",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-05-20T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const supportedBrief = await runIntelligencePipeline(englishInput, coverage, generatedAt, {
    store: supportedStore,
    generationProvider: supported.value,
    retrieval: { retrieve: async () => retrievalResult([englishSearch]) },
    acquireEvidence: acquireWithAttributes,
  });
  assert.equal(supportedBrief.importantFacts.length, 0, "unclassified English action must not become a confirmed fact");
  assert.equal(supportedBrief.otherItems.length, 1, "source-backed English attributes remain available as a clue");
  assert.equal(supportedBrief.otherItems[0]?.isClue, true);

  const mismatchedRoleStore = new MemoryStore();
  const mismatchedRole = providerWithBundle((evidenceId) => ({
    overview: "One financing event was identified.",
    facts: [{
      headline: "Unitree Robotics raised $100 million in Series B financing; Sequoia Capital led the financing",
      summary: "Unitree Robotics raised $100 million; Sequoia Capital was the lead investor.",
      assessment: "The financing is material for the company.",
      eventDate: null,
      eventTimeText: null,
      eventType: "financing",
      entities: ["Unitree Robotics", "Sequoia Capital"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "financing and investor role",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const acquireParticipantOnly: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "Unitree Robotics raised 1亿美元 in Series B financing. Sequoia Capital participated in the financing.",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-05-20T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const mismatchedRoleBrief = await runIntelligencePipeline(englishInput, coverage, generatedAt, {
    store: mismatchedRoleStore,
    generationProvider: mismatchedRole.value,
    retrieval: { retrieve: async () => retrievalResult([englishSearch]) },
    acquireEvidence: acquireParticipantOnly,
  });
  assert.equal(mismatchedRoleBrief.importantFacts.length, 0, "participation evidence must not be promoted to a lead-investor claim");
  assert.equal(mismatchedRoleBrief.itemCount, 1, "the source-backed financing action may remain as a sparse clue");
  assert.equal(mismatchedRoleBrief.otherItems[0]?.isClue, true);
  assert.doesNotMatch(JSON.stringify(mismatchedRoleBrief), /lead investor|led the financing/i);

  const equivalentUsdStore = new MemoryStore();
  const equivalentUsd = providerWithBundle((evidenceId) => ({
    overview: "One source-backed financing event was identified.",
    facts: [{
      headline: "Unitree Robotics raised $100 million in Series B financing; Sequoia Capital was the lead investor",
      summary: "Unitree Robotics raised USD 100m and Sequoia Capital led the financing.",
      assessment: "The financing is material for the company.",
      eventDate: null,
      eventTimeText: null,
      eventType: "financing",
      entities: ["Unitree Robotics", "Sequoia Capital"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "financing and investor role",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const acquireEquivalentUsd: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "Unitree Robotics raised 1亿美元 in Series B financing. Sequoia Capital led the financing.",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-05-20T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const equivalentUsdBrief = await runIntelligencePipeline(englishInput, coverage, generatedAt, {
    store: equivalentUsdStore,
    generationProvider: equivalentUsd.value,
    retrieval: { retrieve: async () => retrievalResult([englishSearch]) },
    acquireEvidence: acquireEquivalentUsd,
  });
  assert.equal(equivalentUsdBrief.itemCount, 1, "1亿美元 and $100 million must compare as the same amount");
  assert.match(JSON.stringify(equivalentUsdBrief), /\$100 million/);

  const equivalentCnyStore = new MemoryStore();
  const equivalentCny = providerWithBundle((evidenceId) => ({
    overview: "识别到一项有来源的融资事件。",
    facts: [{
      headline: "宇树科技完成10亿元B2轮融资",
      summary: "宇树科技完成10亿元B2轮融资，红杉资本领投。",
      assessment: "融资事件与主题直接相关。",
      eventDate: null,
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技", "红杉资本"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "融资主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "high",
  }));
  const acquireEquivalentCny: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "宇树科技完成人民币10亿B2轮融资，红杉资本领投。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-05-20T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const equivalentCnyBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: equivalentCnyStore,
    generationProvider: equivalentCny.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/unitree-cny")]) },
    acquireEvidence: acquireEquivalentCny,
  });
  assert.equal(equivalentCnyBrief.itemCount, 1, "人民币10亿 and 10亿元 must compare as the same amount");
  assert.match(JSON.stringify(equivalentCnyBrief), /10亿元/);

  const approximateAmountStore = new MemoryStore();
  const approximateAmount = providerWithBundle((evidenceId) => ({
    overview: "识别到一项融资事件。",
    facts: [{
      headline: "宇树科技完成10亿元B2轮融资",
      summary: "宇树科技完成10亿元B2轮融资。",
      assessment: "融资规模较大。",
      eventDate: null,
      eventTimeText: "2024年春节前",
      eventType: "融资",
      entities: ["宇树科技"],
      status: "reported",
      relevance: "high",
      relevanceReason: "融资主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: [],
    confidence: "medium",
  }));
  // Sanitized replay of the public Oeeee body saved by real run
  // 05d07906-e056-42f3-8497-8ecaef8979dd. The observed model output dropped
  // “近”; this fixture proves the production parser now rejects that promotion.
  const acquireApproximateAmount: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "继今年年初完成近10亿元人民币融资后，宇树科技近期再度收获一笔超亿元融资；此前美团战投参与了宇树科技今年2月的B2轮融资。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-09-23T16:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const approximateAmountBrief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: approximateAmountStore,
    generationProvider: approximateAmount.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/unitree-near-cny")]) },
    acquireEvidence: acquireApproximateAmount,
  });
  assert.equal(approximateAmountBrief.itemCount, 1, "a rejected exact amount must retain a sparse source-backed clue instead of discarding all user value");
  assert.equal(approximateAmountBrief.otherItems[0]?.isClue, true);
  assert.match(approximateAmountBrief.otherItems[0]?.title || "", /融资相关线索待核验/);
  assert.doesNotMatch(JSON.stringify(approximateAmountBrief), /完成10亿元B2轮融资/);
  assert.equal(approximateAmountBrief.metadata.research?.mode === "pipeline-v2" ? approximateAmountBrief.metadata.research.evidenceFallbackClues : 0, 1);
}

async function structuredAttributesAreAcceptedIndependently() {
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "模型概览不会直接发布。",
    facts: [{
      p: "宇树科技",
      h: "宇树科技完成10亿元B2轮融资，红杉资本领投",
      s: "宇树科技完成10亿元B2轮融资，红杉资本领投。",
      a: "具体金额和投资方仍需核验。",
      d: null,
      t: "融资",
      e: ["宇树科技", "红杉资本"],
      x: [
        { k: "round", v: "B2轮", n: "宇树科技", o: null, ids: [evidenceId] },
        { k: "amount", v: "10亿元", n: "宇树科技", o: null, ids: [evidenceId] },
        { k: "role", v: "红杉资本领投", n: "红杉资本", o: "lead-investor", ids: [evidenceId] },
      ],
      st: "confirmed",
      r: "high",
      rr: "融资事项",
      ids: [evidenceId],
    }],
    g: [],
    c: "medium",
  }));
  const acquirePartialAttributes: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "宇树科技完成近10亿元B2轮融资，投资方包括美团和源码资本。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-02-23T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/structured-partial")]) },
    acquireEvidence: acquirePartialAttributes,
  });
  assert.equal(brief.itemCount, 1, "one unsupported attribute must not discard the supported event and round");
  assert.equal(brief.importantFacts.length, 0, "an item with removed transaction attributes remains a clue");
  assert.equal(brief.otherItems[0]?.isClue, true);
  assert.match(brief.otherItems[0]?.title || "", /B2轮/);
  assert.match(brief.otherItems[0]?.followUpReason || "", /金额|参与方角色/);
  assert.doesNotMatch(JSON.stringify(brief), /红杉|(?<!近)10亿元融资/);
  const sanitized = store.checkpoints.get("facts")?.diagnostics.sanitizedFields as Record<string, number>;
  assert.equal(sanitized.unsupported_amount_removed, 1);
  assert.equal(sanitized.unsupported_role_removed, 1);
}

async function oneSourceCanSupportMultipleDistinctEvents() {
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "同一公开页面包含两轮融资。",
    facts: [
      {
        p: "宇树科技", h: "宇树科技完成B2轮融资", s: "宇树科技完成B2轮融资。", a: "", d: null, t: "融资", e: ["宇树科技"],
        x: [{ k: "round", v: "B2轮", n: "宇树科技", o: null, ids: [evidenceId] }], st: "confirmed", r: "high", rr: "融资事项", ids: [evidenceId],
      },
      {
        p: "宇树科技", h: "宇树科技完成C轮融资", s: "宇树科技完成C轮融资。", a: "", d: null, t: "融资", e: ["宇树科技"],
        x: [{ k: "round", v: "C轮", n: "宇树科技", o: null, ids: [evidenceId] }], st: "confirmed", r: "high", rr: "融资事项", ids: [evidenceId],
      },
    ],
    g: [],
    c: "high",
  }));
  const acquireTwoEvents: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "宇树科技于2024年2月完成B2轮融资。2024年9月，宇树科技又完成C轮融资。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-09-24T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/two-rounds-one-page")]) },
    acquireEvidence: acquireTwoEvents,
  });
  const allItems = [...brief.importantFacts, ...brief.otherItems];
  assert.equal(allItems.length, 2, "different rounds in one source are distinct events");
  assert.equal(new Set(allItems.map((item) => item.id)).size, 2);
  assert.deepEqual(new Set(allItems.map((item) => item.sourceUrl)), new Set(["https://example.com/two-rounds-one-page"]));
  assert.match(allItems.map((item) => item.title).join(" | "), /B2轮/);
  assert.match(allItems.map((item) => item.title).join(" | "), /C轮/);
}

async function legalEmptyFactsStillPreserveRelevantEvidenceAsAClue() {
  const store = new MemoryStore();
  const generation = providerWithBundle(() => ({ facts: [], g: ["模型未形成结构化事项"], c: "low" }));
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([searchItem("https://example.com/legal-empty-facts")]) },
    acquireEvidence: acquireFull,
  });
  assert.equal(store.checkpoints.get("facts")?.diagnostics.acceptedItems, 0);
  assert.equal(store.checkpoints.get("facts")?.diagnostics.rejectedItems, 0);
  assert.equal(brief.itemCount, 1, "evidence-backed relevance must not depend on the model producing a rejected row");
  assert.equal(brief.otherItems[0]?.isClue, true);
  assert.match(brief.otherItems[0]?.title || "", /融资相关线索待核验/);
}

async function structuredAcquisitionKeepsSupportedCounterpartyOnly() {
  const acquisitionInput: IntelligenceTaskInput = {
    ...input,
    name: "甲公司并购动态",
    originalRequest: "跟踪甲公司并购和股权投资事项",
    topics: ["并购"],
    entities: ["甲公司"],
    keywords: ["收购"],
    eventTypes: ["并购"],
  };
  const store = new MemoryStore();
  const generation = providerWithBundle((evidenceId) => ({
    facts: [{
      p: "甲公司", h: "甲公司以5亿元收购乙公司", s: "甲公司收购乙公司，交易金额5亿元。", a: "", d: null, t: "并购", e: ["甲公司", "乙公司"],
      x: [
        { k: "party", v: "乙公司", n: "乙公司", o: "target", ids: [evidenceId] },
        { k: "amount", v: "5亿元", n: "甲公司", o: null, ids: [evidenceId] },
      ],
      st: "confirmed", r: "high", rr: "并购事项", ids: [evidenceId],
    }],
    g: [],
    c: "medium",
  }));
  const acquireAcquisition: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => ({
    candidates: candidates.map((candidate) => Object.assign(candidate, {
      content: "甲公司宣布收购乙公司，交易金额未披露。",
      evidenceStatus: "full" as const,
      evidencePublishedAt: "2024-06-01T00:00:00.000Z",
    })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  });
  const acquisitionSearch = searchItem("https://example.com/acquisition");
  acquisitionSearch.title = "甲公司宣布收购乙公司";
  acquisitionSearch.snippet = "甲公司宣布收购乙公司。";
  const brief = await runIntelligencePipeline(acquisitionInput, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([acquisitionSearch]) },
    acquireEvidence: acquireAcquisition,
  });
  assert.equal(brief.itemCount, 1);
  assert.match(JSON.stringify(brief), /乙公司/);
  assert.doesNotMatch(JSON.stringify(brief), /5亿元/);
  assert.equal(brief.otherItems[0]?.isClue, true);
}

async function liveCandidateReplayCompletesSearchEvidenceFactsAndBrief() {
  const store = new MemoryStore();
  const replayRows = [
    { title: "10亿元！智能机器人初创公司宇树科技B2轮融资完成", url: "https://stcn.com/article/detail/1127375.html", site_name: "证券时报", date: "2024-02-23T00:00:00+08:00", summary: "宇树科技完成近10亿元B2轮融资。" },
    { title: "宇树科技完成B2轮融资，融资近10亿元", url: "https://finance.sina.com.cn/jjxw/2024-02-23/doc-inaizhpm5399592.shtml", site_name: "新浪财经", date: "2024-02-23T00:00:00+08:00", summary: "宇树科技完成B2轮融资。" },
    { title: "智能机器人公司宇树科技完成10亿元B2轮融资 美团参投", url: "https://finance.eastmoney.com/a/202402232993053542.html", site_name: "东方财富", date: "2024-02-23T00:00:00+08:00", summary: "超长候选摘要".repeat(900) },
    { title: "宇树科技C轮获数亿人民币融资，美团继续加码人形机器人创企", url: "https://finance.eastmoney.com/news/1354,202409243189491433.html", site_name: "东方财富", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技C轮融资报道。" },
    { title: "宇树科技C轮获数亿人民币融资，美团继续加码人形机器人创企", url: "https://baijiahao.baidu.com/s?id=1811054451037922436", site_name: "百家号", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技C轮融资转载。" },
    { title: "美团再投人形机器人公司宇树科技", url: "https://www.tmtpost.com/7262451.html?rss=futu", site_name: "钛媒体", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技融资背景报道。" },
    { title: "宇树科技新一轮融资进账数亿元", url: "https://m.mp.oeeee.com/oe/BAAFRD0000202409241002975.html", site_name: "Oeeee", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技新一轮融资报道。" },
    { title: "宇树科技完成近10亿元B2轮融资，中网投追加投资", url: "http://www.ciifund.net/zwt/tpxw/202403/dd881d0e338a409cad2a1e9630ef39c7.shtml", site_name: "ciifund.net", date: "2024-11-01T00:00:00+08:00", summary: "宇树科技B2轮融资报道。" },
    { title: "智能机器人公司宇树科技完成10亿元B2轮融资 美团参投", url: "https://fund.eastmoney.com/a/202402232993053542.html", site_name: "天天基金网", date: "2024-02-23T00:00:00+08:00", summary: "宇树科技B2轮融资报道。" },
    { title: "智能机器人公司宇树科技完成10亿元B2轮融资 美团参投", url: "http://www.mrjjxw.com/articles/2024-02-23/3253893.html", site_name: "每日经济网", date: "2024-02-23T16:40:28+08:00", summary: "宇树科技B2轮融资报道。" },
    { title: "宇树科技完成近10亿元B2轮融资，中网投追加投资", url: "http://ciifund.com.cn/zwt/gsxw/202403/c8461bcfe86042769b57be24e3d5511e.shtml", site_name: "ciifund.com.cn", date: "2024-11-01T00:00:00+08:00", summary: "宇树科技B2轮融资报道。" },
    { title: "容亿投后｜宇树科技完成近10亿元B2轮融资", url: "http://www.winreal.vc/nd.jsp?id=407&fromMid=3&groupId=-1", site_name: "winreal.vc", date: "2024-12-18T00:00:00+08:00", summary: "宇树科技B2轮融资报道。" },
    { title: "参展企业VC/PE渗透率超75%，世界机器人大会展现创投力量", url: "https://www.21jingji.com/article/20240823/herald/d4e61f699f74ee645f343d295f949151.html", site_name: "21财经", date: "2024-08-23T00:00:00+08:00", summary: "机器人行业资本背景。" },
    { title: "参展企业VC/PE渗透率超75%，世界机器人大会展现创投力量", url: "https://stcn.com/article/detail/1297474.html", site_name: "证券时报", date: "2024-08-26T00:00:00+08:00", summary: "机器人行业资本背景。" },
    { title: "宇树科技C轮获数亿人民币融资，美团继续加码", url: "https://www.163.com/dy/article/JCRSRRJR05129QAF.html", site_name: "网易手机", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技C轮融资报道。" },
    { title: "宇树科技C轮获数亿人民币融资", url: "https://guba.eastmoney.com/news,cjpl,1464092701.html", site_name: "股吧", date: "2024-09-24T00:00:00+08:00", summary: "宇树科技C轮融资转载。" },
    { title: "北京国资，投了90后浙商", url: "https://m.lieyunpro.com/archives/494671", site_name: "Lieyunpro", date: "2024-09-29T00:00:00+08:00", summary: "宇树科技投资背景报道。" },
    { title: "北京国资，投了90后浙商", url: "https://www.lieyunpro.com/archives/494671", site_name: "猎云网", date: "2024-09-29T00:00:00+08:00", summary: "宇树科技投资背景报道。" },
  ];
  const createReplayRetrieval = () => {
    const adapter = createDeepSeekSearchFetchAdapter({
      apiKey: "offline-replay-key",
      baseURL: "https://api.deepseek.com/v1",
      budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
      maxAttempts: 1,
      fetchImpl: async () => new Response(JSON.stringify({ results: replayRows }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    return { adapter, retrieval: new IntelligenceRetrievalOrchestrator([], [adapter]) };
  };
  const { adapter, retrieval } = createReplayRetrieval();
  const generation = providerWithBundle((evidenceId) => ({
    overview: "识别到一项有正文支持的融资事项。",
    facts: [{
      headline: "宇树科技完成 B2 轮融资",
      summary: "公开报道显示宇树科技完成 B2 轮融资。",
      assessment: "该融资事项值得继续核验其金额和投资方。",
      eventDate: null,
      eventTimeText: "2024年2月",
      eventType: "融资",
      entities: ["宇树科技"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "直接对应融资主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: ["金额与完整投资方名单仍需更多正文交叉核验"],
    confidence: "medium",
  }));
  const acquireReplay: EvidenceAcquirer = async <T extends EvidenceCandidate>(candidates: T[]) => {
    assert.equal(candidates.length, 12, "本次真实运行只选择前 12 个候选做正文取证");
    assert.ok(candidates.every((candidate) => candidate.origin === "web-search"), "Search 候选必须进入正文取证队列");
    const updated = candidates.map((candidate) => {
      const url = candidate.sourceUrl || "";
      if (url.includes("stcn.com/article/detail/1127375")) return Object.assign(candidate, {
        content: `近日，宇树科技宣布完成近10亿元B2轮融资，投资方包括美团、金石投资、源码资本。${"背景资料。".repeat(900)}`,
        evidenceStatus: "full" as const, evidencePublishedAt: "2024-02-23T00:00:00+08:00",
      });
      if (url.includes("tmtpost.com") || url.includes("oeeee.com")) return Object.assign(candidate, {
        content: "2024年9月报道显示，宇树科技近期完成数亿元人民币C轮融资，多家机构参与。",
        evidenceStatus: "full" as const, evidencePublishedAt: "2024-09-24T00:00:00+08:00",
      });
      if (url.includes("fund.eastmoney.com") || url.includes("mrjjxw.com")) return Object.assign(candidate, {
        content: "宇树科技于2024年春节前完成B2轮融资，金额近10亿元人民币。",
        evidenceStatus: "partial" as const, evidencePublishedAt: "2024-02-23T00:00:00+08:00",
      });
      return Object.assign(candidate, { evidenceStatus: "unavailable" as const, evidenceFailureReason: "controlled_unavailable" });
    });
    return { candidates: updated, stats: { attempted: 12, full: 3, partial: 2, unavailable: 7 } };
  };
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval,
    acquireEvidence: acquireReplay,
    maxSearchQueries: 2,
  });
  assert.equal(adapter.usageSnapshot().searchCompleted, 2);
  assert.equal(adapter.usageSnapshot().billableSearch, 2);
  assert.equal((await store.listEvidence()).length, 18);
  assert.ok((await store.listEvidence()).every((item) => [...item.snippet].length <= 1_200), "供应商超长摘要必须有界截断而不是终止检索");
  assert.ok((await store.listEvidence()).every((item) => [...item.contentExcerpt].length <= 3_500), "正文取证结果也必须有界截断而不是终止流水线");
  assert.equal(brief.itemCount, 1);
  assert.equal(brief.sourceList.length, 18, "候选来源和最终简报必须来自同一持久快照");
  assert.equal(brief.importantFacts[0]?.sourceUrl, "https://stcn.com/article/detail/1127375.html");
  assert.equal(store.checkpoints.get("retrieval")?.status, "completed");
  assert.equal(store.checkpoints.get("evidence")?.payload.attempted, 12);
  assert.equal(store.checkpoints.get("evidence")?.payload.full, 3);
  assert.equal(store.checkpoints.get("evidence")?.payload.partial, 2);

  // Reuse the saved real-source shape, but simulate a provider that completes
  // one compact fact and then reaches its output limit. No network/model call is
  // made here; this is a deterministic replay of the production path.
  const truncatedStore = new MemoryStore();
  const replayAgain = createReplayRetrieval();
  let generationCalls = 0;
  const truncatedGeneration: IntelligenceProvider = {
    id: "deepseek",
    model: "fixture-model",
    capabilities: { generation: true, nativeWebSearch: false, structuredOutput: true },
    async generate(request) {
      generationCalls += 1;
      const evidenceId = request.prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
      assert.ok(evidenceId);
      const completeFact = {
        h: "宇树科技完成近10亿元 B2 轮融资",
        s: "公开报道显示宇树科技完成近10亿元 B2 轮融资，投资方包括美团、金石投资和源码资本。",
        a: "该轮融资显示机器人赛道资本活跃。",
        d: null,
        t: "融资",
        e: ["宇树科技", "美团", "金石投资", "源码资本"],
        st: "confirmed",
        r: "high",
        rr: "直接对应融资主题",
        ids: [evidenceId],
      };
      const partial = `{"facts":[${JSON.stringify(completeFact)},{"h":"未完成尾项`;
      for (let offset = 0; offset < partial.length; offset += 23) await request.onOutputChunk?.(partial.slice(offset, offset + 23));
      const error = new AICompletionTruncatedError() as AICompletionTruncatedError & { externalCallCompleted?: boolean };
      error.externalCallCompleted = true;
      throw error;
    },
  };
  const recovered = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: truncatedStore,
    generationProvider: truncatedGeneration,
    retrieval: replayAgain.retrieval,
    acquireEvidence: acquireReplay,
    maxSearchQueries: 2,
  });
  assert.equal(replayAgain.adapter.usageSnapshot().searchCompleted, 2);
  assert.equal((await truncatedStore.listEvidence()).length, 18);
  assert.equal(recovered.itemCount, 1);
  assert.equal(recovered.sourceList.length, 18);
  assert.equal(truncatedStore.checkpoints.get("facts")?.status, "partial");
  assert.equal(truncatedStore.checkpoints.get("brief")?.status, "partial");
  assert.equal(truncatedStore.checkpoints.get("facts")?.diagnostics.automaticReplayAllowed, false);
  const recoveredAgain = await runIntelligencePipeline(input, coverage, generatedAt, {
    store: truncatedStore,
    generationProvider: truncatedGeneration,
    retrieval: { retrieve: async () => { throw new Error("saved source replay must not search again"); } },
    acquireEvidence: async () => { throw new Error("saved evidence replay must not fetch again"); },
  });
  assert.equal(recoveredAgain.itemCount, 1);
  assert.equal(generationCalls, 1, "saved-source truncation recovery must not issue another generation request");
}

async function laterRelevantSourceIsSelectedForEvidenceAcquisition() {
  const store = new MemoryStore();
  const generation = provider();
  let acquisitionCalls = 0;
  const generic = Array.from({ length: 12 }, (_, index): WebSearchItem => ({
    title: `机器人行业背景 ${index + 1}`,
    url: `https://example.com/background-${index + 1}`,
    siteName: "行业转载",
    snippet: "机器人行业发展背景。",
    publishedAt: "2024-06-01T00:00:00.000Z",
    sourceTier: "C",
    domain: "example.com",
    query: "机器人行业",
    searchProviders: ["fixture-search"],
  }));
  const lateRelevant: WebSearchItem = {
    title: "宇树科技完成 B2 轮融资",
    url: "https://example.com/late-authoritative-unitree",
    siteName: "权威财经来源",
    snippet: "宇树科技完成 B2 轮融资。",
    publishedAt: "2024-02-02T00:00:00.000Z",
    sourceTier: "A",
    domain: "example.com",
    query: "宇树科技 融资",
    searchProviders: ["fixture-search"],
  };
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult([...generic, lateRelevant]) },
    acquireEvidence: async <T extends EvidenceCandidate>(candidates: T[]) => {
      acquisitionCalls += 1;
      if (acquisitionCalls === 1) {
        assert.equal(candidates.length, 12);
        assert.ok(
          candidates.some((candidate) => candidate.sourceUrl === lateRelevant.url),
          "a later source with stronger subject/event relevance and source tier must displace generic provider-order results",
        );
      } else {
        assert.equal(candidates.length, 1, "the bounded backfill may inspect the one remaining candidate without replaying earlier URLs");
        assert.notEqual(candidates[0]?.sourceUrl, lateRelevant.url);
      }
      const updated = candidates.map((candidate) => candidate.sourceUrl === lateRelevant.url
        ? Object.assign(candidate, {
            content: "宇树科技于2024年2月完成B2轮融资。",
            evidenceStatus: "full" as const,
            evidencePublishedAt: lateRelevant.publishedAt,
          })
        : Object.assign(candidate, {
            evidenceStatus: "unavailable" as const,
            evidenceFailureReason: "controlled_irrelevant",
          }));
      return {
        candidates: updated,
        stats: { attempted: updated.length, full: 1, partial: 0, unavailable: updated.length - 1 },
      };
    },
  });
  assert.equal(acquisitionCalls, 2);
  assert.equal(store.checkpoints.get("evidence")?.payload.attempted, 13);
  assert.equal(brief.itemCount, 1);
  assert.equal(brief.importantFacts[0]?.sourceUrl, lateRelevant.url);
}

async function failedEvidenceFetchesTriggerBoundedBackfill() {
  const store = new MemoryStore();
  const generation = provider();
  const candidates = Array.from({ length: 18 }, (_, index): WebSearchItem => ({
    ...searchItem(`https://example.com/backfill-${index + 1}`),
    title: `宇树科技融资候选 ${index + 1}`,
  }));
  const batchSizes: number[] = [];
  let attempts = 0;
  const brief = await runIntelligencePipeline(input, coverage, generatedAt, {
    store,
    generationProvider: generation.value,
    retrieval: { retrieve: async () => retrievalResult(candidates) },
    acquireEvidence: async <T extends EvidenceCandidate>(batch: T[]) => {
      batchSizes.push(batch.length);
      const updated = batch.map((candidate, index) => {
        const ordinal = attempts + index;
        return Object.assign(candidate, ordinal >= 12 && ordinal < 14
          ? {
              content: "宇树科技于2024年2月1日完成B2轮融资。",
              evidenceStatus: "full" as const,
              evidencePublishedAt: "2024-02-02T00:00:00.000Z",
            }
          : { evidenceStatus: "unavailable" as const, evidenceFailureReason: "controlled_fetch_failure" });
      });
      attempts += batch.length;
      const full = updated.filter((candidate) => candidate.evidenceStatus === "full").length;
      return { candidates: updated, stats: { attempted: updated.length, full, partial: 0, unavailable: updated.length - full } };
    },
  });
  assert.deepEqual(batchSizes, [12, 4], "failed first-choice fetches must backfill without exceeding the fixed attempt cap");
  assert.equal(store.checkpoints.get("evidence")?.payload.attempted, 16);
  assert.equal(store.checkpoints.get("evidence")?.payload.full, 2);
  assert.equal((await store.listEvidence()).filter((item) => item.evidenceStatus === null).length, 2);
  assert.equal(brief.itemCount, 1);
}

async function main() {
  await successfulVerticalSlice();
  await coarseEmptyIsInsufficient();
  await candidatesSurviveInterruptedRetrieval();
  await completedInvalidOutputNeverAutoReplays();
  await oneInvalidFactDoesNotDiscardValidEvidenceBoundFact();
  await compactStreamingOutputPersistsCompleteFactsAndNeverAutoReplays();
  await eventDateMustBelongToTheSameSubjectAndEvent();
  await unrelatedEvidenceCannotPublishAndOverviewCannotClaimAbsence();
  await fullTaskSemanticsReachQueriesCheckpointAndPrompt();
  await unsupportedAmountInvestorAndNegativeOverviewAreRejected();
  await supportedAttributesRemainFactsAndUnknownActionsRemainClues();
  await englishAmountsAndParticipantsRequireConcreteSourceSupport();
  await structuredAttributesAreAcceptedIndependently();
  await oneSourceCanSupportMultipleDistinctEvents();
  await legalEmptyFactsStillPreserveRelevantEvidenceAsAClue();
  await structuredAcquisitionKeepsSupportedCounterpartyOnly();
  await laterRelevantSourceIsSelectedForEvidenceAcquisition();
  await failedEvidenceFetchesTriggerBoundedBackfill();
  await liveCandidateReplayCompletesSearchEvidenceFactsAndBrief();
  console.log("intelligence deterministic pipeline: 19 stories passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
