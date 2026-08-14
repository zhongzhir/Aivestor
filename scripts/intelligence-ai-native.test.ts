import assert from "node:assert/strict";
import { buildAiNativeBriefResult, normalizeTaskInput } from "@/lib/intelligence";
import { AI_NATIVE_PUBLICATION_SELF_AUDIT, answerCharacterCount, enforceAiNativePublicationConstraint, enforceAiNativeTimeWindow, explicitAnswerCharacterLimit, runAiNativeResearch, type AiNativeResearchReport } from "@/lib/intelligenceAiNative";
import type { IntelligenceAgentTurnResult, IntelligenceProvider, RetrievalRequest, RetrievalResult } from "@/lib/intelligenceProvider";
import type { EvidenceCandidate } from "@/lib/intelligenceEvidence";

const input = normalizeTaskInput({
  name: "指定时期前沿产业投融资研究",
  topics: ["前沿产业"],
  lookbackPeriod: { kind: "custom", start: "2026-08-06T00:00:00.000Z", end: "2026-08-09T23:59:59.999Z" },
  outputInstructions: "形成不超过500字的研究简报。",
  isActive: true,
});
const coverage = { start: new Date("2026-08-06T00:00:00.000Z"), end: new Date("2026-08-09T23:59:59.999Z") };
const readUrl = "https://primary.example/event-a";
const unreadUrl = "https://media.example/event-b";
const illegalUrl = "https://outside.example/not-searched";
const directAnswer = "【研究结论】甲公司事项已有原文支持；乙公司事项仍待进一步核实。";

function retrieval(): { retrieve(request: RetrievalRequest): Promise<RetrievalResult> } {
  return {
    async retrieve(request) {
      const queries = request.queries || [];
      const results = [
        { title: "甲公司事项", url: readUrl, siteName: "公告平台", snippet: "甲公司披露事项。", publishedAt: "2026-08-07", sourceTier: "S" as const, domain: "primary.example", query: queries[0] || "" },
        { title: "乙公司事项", url: unreadUrl, siteName: "财经媒体", snippet: "乙公司据报推进事项。", publishedAt: "2026-08-08", sourceTier: "A" as const, domain: "media.example", query: queries[1] || queries[0] || "" },
      ];
      return { status: "success", providers: [{ provider: "synthetic-web", attempted: true, succeeded: true, queryCount: queries.length, resultCount: results.length }], results };
    },
  };
}

async function acquire<T extends EvidenceCandidate>(candidates: T[]) {
  return {
    candidates: candidates.map((candidate) => Object.assign(candidate, { content: "甲公司公告确认该事项已经发生。", evidenceStatus: "full" as const, evidencePublishedAt: "2026-08-07" })),
    stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
  };
}

function toolCall(name: string, args: object, id: string): IntelligenceAgentTurnResult {
  return { content: null, reasoningContent: "must never enter telemetry", toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

async function main() {
  const baseReport: AiNativeResearchReport = { answer: "短".repeat(420), items: [], searchedAreas: [], unresolvedGaps: [], confidence: "medium" };
  let publicationRepairCalls = 0;
  const publicationProvider: IntelligenceProvider = {
    id: "publication-provider", model: "publication-model",
    capabilities: { generation: true, nativeWebSearch: false },
    async generate() { publicationRepairCalls++; return JSON.stringify({ answer: "修复后的精炼回答。" }); },
  };
  assert.equal(explicitAnswerCharacterLimit(input), 500);
  const unchanged = await enforceAiNativePublicationConstraint(input, baseReport, publicationProvider, new Set());
  assert.equal(unchanged.answer, baseReport.answer, "满足 500 字限制时 answer 必须完全不变");
  assert.equal(publicationRepairCalls, 0, "满足限制时不得触发 repair");

  const longReport: AiNativeResearchReport = { ...baseReport, answer: "甲".repeat(1_000) };
  const repairedPublication = await enforceAiNativePublicationConstraint(input, longReport, publicationProvider, new Set());
  assert.equal(publicationRepairCalls, 1, "超长时只允许一次 Publication Format Repair");
  assert.equal(repairedPublication.answer, "修复后的精炼回答。");
  assert.ok(answerCharacterCount(repairedPublication.answer) <= 500);
  assert.notEqual(repairedPublication.answer, longReport.answer.slice(0, 500), "不得用字符串截断代替模型修复");

  const stillLongProvider: IntelligenceProvider = { ...publicationProvider, async generate() { return JSON.stringify({ answer: "乙".repeat(600) }); } };
  await assert.rejects(enforceAiNativePublicationConstraint(input, longReport, stillLongProvider, new Set()), /AI_NATIVE_PUBLICATION_CONSTRAINT_FAILED/);

  const noLimitInput = normalizeTaskInput({ ...input, name: "前沿产业研究", outputInstructions: "形成研究简报。", includeRequirements: [] });
  const noLimit = await enforceAiNativePublicationConstraint(noLimitInput, longReport, { ...publicationProvider, async generate() { throw new Error("must not run"); } }, new Set());
  assert.equal(noLimit.answer, longReport.answer, "没有明确长度限制时不得自行创造限制");
  assert.match(AI_NATIVE_PUBLICATION_SELF_AUDIT, /publication date != event date/i);
  assert.match(AI_NATIVE_PUBLICATION_SELF_AUDIT, /历史事件[\s\S]*context/);

  const windowRepair = await enforceAiNativeTimeWindow({
    answer: "2024年7月发生了相关融资。",
    items: [{ headline: "历史融资", summary: "历史事项", eventDate: "2024-07-10", entities: ["甲公司"], status: "confirmed", sourceUrls: [] }],
    searchedAreas: [], unresolvedGaps: [], confidence: "low",
  }, { start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-07-31T23:59:59.999Z") }, {
    id: "window-repair", capabilities: { generation: true, nativeWebSearch: false },
    async generate() { return JSON.stringify({ answer: "本期在指定时间窗口内未发现可确认的新增事项。" }); },
  });
  assert.equal(windowRepair.items[0]?.status, "context", "窗口外事项必须降为背景");
  assert.doesNotMatch(windowRepair.answer, /2024年7月/, "窗口外日期不得进入最终回答");

  let turn = 0;
  const provider: IntelligenceProvider = {
    id: "synthetic-agent",
    model: "synthetic-model",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      turn++;
      if (turn === 1) return toolCall("web_search", { queries: ["产业事项一", "产业事项二"] }, "search-1");
      if (turn === 2) return toolCall("read_url", { urls: [readUrl] }, "read-1");
      return { content: JSON.stringify({
        answer: directAnswer,
        items: [
          { headline: "甲公司确认事项", summary: "公告支持。", eventDate: "2026-08-07", entities: ["甲公司"], status: "confirmed", sourceUrls: [readUrl] },
          { headline: "乙公司待核事项", summary: "报道尚待核实。", eventDate: "2026-08-08", entities: ["乙公司"], status: "confirmed", sourceUrls: [unreadUrl] },
          { headline: "乙公司另一报道", summary: "仍有现实信息价值。", eventDate: null, entities: ["乙公司"], status: "reported", sourceUrls: [unreadUrl] },
          { headline: "历史背景", summary: "仅用于解释。", eventDate: "2026-07-01", entities: ["甲公司"], status: "context", sourceUrls: [readUrl] },
          { headline: "池外来源事项", summary: "非法来源 URL 应被移除，但报告仍保留。", eventDate: null, entities: [], status: "reported", sourceUrls: [illegalUrl] },
        ],
        searchedAreas: ["产业融资"], unresolvedGaps: ["乙公司原始公告"], confidence: "medium",
      }), reasoningContent: "hidden", toolCalls: [] };
    },
    async generate() { throw new Error("direct finalization should not call generate"); },
  };

  const result = await runAiNativeResearch(input, coverage, { generationProvider: provider, retrieval: retrieval(), acquireEvidence: acquire });
  assert.equal(result.report.answer, directAnswer, "AI answer must remain the first-class output");
  assert.equal(result.importantFacts.length, 1, "confirmed with a successful read becomes an important fact");
  assert.equal(result.otherItems.length, 3, "reported items and a downgraded confirmed item remain visible");
  assert.equal(result.report.items[1]?.status, "reported", "confirmed without a successful read must be downgraded, not deleted");
  assert.equal(result.report.items.find((item) => item.headline === "池外来源事项")?.sourceUrls.length, 0, "URLs outside the search pool must be removed");
  assert.ok(!result.importantFacts.some((item) => item.title === "历史背景") && !result.otherItems.some((item) => item.title === "历史背景"), "context must not become a current-event card");
  assert.equal(result.trendSignals.length, 0);
  assert.equal(result.telemetry.provider, "synthetic-agent");
  assert.equal(result.telemetry.model, "synthetic-model");
  assert.equal(result.telemetry.finalization, "direct");
  assert.equal(result.telemetry.finalRepairAttempted, false);
  assert.equal(result.telemetry.finalRepairSucceeded, false);
  assert.doesNotMatch(JSON.stringify(result.telemetry), /must never enter telemetry|hidden/);

  const brief = buildAiNativeBriefResult(input, coverage, new Date("2026-08-09T12:00:00.000Z"), provider, result);
  assert.equal(brief.metadata.overview, directAnswer, "BriefResult must use report.answer without a second rewrite");
  assert.equal(brief.metadata.research?.mode, "ai-native");
  assert.equal(brief.metadata.generationModel, "synthetic-model");
  assert.notEqual(brief.metadata.overview, "本期未发现符合条件、且可核验的新增事实。");

  let repairTurn = 0;
  let finalRepairCalls = 0;
  let forcedFinalizationCalls = 0;
  let repairSearchCalls = 0;
  let repairReadCalls = 0;
  const repairedProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn() {
      repairTurn++;
      if (repairTurn === 1) return toolCall("web_search", { queries: ["产业事项"] }, "search-repair");
      if (repairTurn === 2) return toolCall("read_url", { urls: [readUrl] }, "read-repair");
      return { content: "{'answer':'保留 Agent 原判断但 JSON 引号损坏','items':[],'searchedAreas':['产业事项'],'unresolvedGaps':[],'confidence':'low'}", reasoningContent: null, toolCalls: [] };
    },
    async generate({ system, prompt }) {
      if (system.includes("Final JSON Repair")) {
        finalRepairCalls++;
        assert.match(prompt, /保留 Agent 原判断但 JSON 引号损坏/);
        return JSON.stringify({
          answer: "保留 Agent 原判断但 JSON 引号损坏",
          items: [{ headline: "甲公司事项", summary: "公告支持。", eventDate: "2026-08-07", entities: ["甲公司"], status: "confirmed", sourceUrls: [readUrl, illegalUrl] }],
          searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low",
        });
      }
      forcedFinalizationCalls++;
      throw new Error("forced finalization must not run after successful repair");
    },
  };
  const repairRetrieval = retrieval();
  const repaired = await runAiNativeResearch(input, coverage, {
    generationProvider: repairedProvider,
    retrieval: { async retrieve(request) { repairSearchCalls++; return repairRetrieval.retrieve(request); } },
    acquireEvidence: async (candidates) => { repairReadCalls++; return acquire(candidates); },
  });
  assert.equal(repaired.report.answer, "保留 Agent 原判断但 JSON 引号损坏");
  assert.equal(repaired.report.items[0]?.sourceUrls.includes(illegalUrl), false, "repair 后仍必须执行 allowed URLs 约束");
  assert.equal(repaired.telemetry.finalization, "repaired");
  assert.equal(repaired.telemetry.finalRepairAttempted, true);
  assert.equal(repaired.telemetry.finalRepairSucceeded, true);
  assert.equal(finalRepairCalls, 1, "损坏的最终 JSON 只 repair 一次");
  assert.equal(forcedFinalizationCalls, 0, "repair 成功后不得触发 forced finalization");
  assert.equal(repairSearchCalls, 1, "Final JSON Repair 不得追加搜索");
  assert.equal(repairReadCalls, 1, "Final JSON Repair 不得追加正文读取");

  let fallbackTurn = 0;
  let failedRepairCalls = 0;
  let fallbackForcedCalls = 0;
  const fallbackProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn() {
      fallbackTurn++;
      if (fallbackTurn === 1) return toolCall("web_search", { queries: ["产业事项"] }, "search-fallback");
      return { content: "broken-final", reasoningContent: null, toolCalls: [] };
    },
    async generate({ system }) {
      if (system.includes("Final JSON Repair")) {
        failedRepairCalls++;
        return "still-broken";
      }
      fallbackForcedCalls++;
      return JSON.stringify({ answer: "forced 收口回答。", items: [], searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low" });
    },
  };
  const forced = await runAiNativeResearch(input, coverage, { generationProvider: fallbackProvider, retrieval: retrieval(), acquireEvidence: acquire });
  assert.equal(forced.report.answer, "forced 收口回答。");
  assert.equal(forced.telemetry.finalization, "forced");
  assert.equal(forced.telemetry.finalRepairAttempted, true);
  assert.equal(forced.telemetry.finalRepairSucceeded, false);
  assert.equal(failedRepairCalls, 1);
  assert.equal(fallbackForcedCalls, 1, "repair 失败后才允许 forced finalization");

  const failedProvider: IntelligenceProvider = {
    ...fallbackProvider,
    async runAgentTurn() { return { content: "not-json", reasoningContent: null, toolCalls: [] }; },
    async generate() { throw new Error("finalization unavailable"); },
  };
  await assert.rejects(
    runAiNativeResearch(input, coverage, { generationProvider: failedProvider, retrieval: retrieval(), acquireEvidence: acquire }),
    /AI_NATIVE_FINALIZATION_FAILED/,
    "failed repair must be an explicit execution failure",
  );

  console.log("intelligence AI-native tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
