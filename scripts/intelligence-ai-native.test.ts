import assert from "node:assert/strict";
import { AICompletionTruncatedError } from "@/lib/ai";
import { buildAiNativeBriefResult, normalizeTaskInput } from "@/lib/intelligence";
import { AI_NATIVE_PUBLICATION_SELF_AUDIT, answerCharacterCount, enforceAiNativeEvidenceBackedDates, enforceAiNativePublicationConstraint, enforceAiNativeTimeWindow, explicitAnswerCharacterLimit, isPublishableAiNativeItem, runAiNativeResearch, type AiNativeResearchReport } from "@/lib/intelligenceAiNative";
import { IntelligenceRetrievalOrchestrator, type IntelligenceAgentTurnResult, type IntelligenceProvider, type RetrievalRequest, type RetrievalResult } from "@/lib/intelligenceProvider";
import type { EvidenceCandidate } from "@/lib/intelligenceEvidence";
import { BailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { intelligenceEventTimeLabel } from "@/components/data-apps/intelligenceTypes";

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
    candidates: candidates.map((candidate) => Object.assign(candidate, { content: "甲公司于2026年8月6日完成融资，公告确认该事项已经发生。", evidenceStatus: "full" as const, evidencePublishedAt: "2026-08-07T09:30:00+08:00" })),
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

  const undatedHistorical = await enforceAiNativeTimeWindow({
    answer: "本期没有新事件。",
    items: [{ headline: "无并购、IPO及其他融资事件发生", summary: "经检索，2024年8月没有相关融资。", eventDate: null, entities: [], status: "reported", sourceUrls: [unreadUrl] }],
    searchedAreas: [], unresolvedGaps: [], confidence: "low",
  }, { start: new Date("2026-08-25T00:00:00.000Z"), end: new Date("2026-09-01T23:59:59.999Z") }, publicationProvider);
  assert.equal(undatedHistorical.items[0]?.status, "context", "缺少 eventDate 的窗口外旧闻也必须降为背景");
  assert.equal(isPublishableAiNativeItem({ headline: "无并购、IPO及其他融资事件发生", summary: "未发现新增融资事件。", eventDate: null, entities: [], status: "reported", sourceUrls: [unreadUrl] }, coverage), false, "否定性非事件不得作为情报卡片发布");
  assert.equal(isPublishableAiNativeItem({ headline: "甲公司宣布完成新一轮融资", summary: "公司宣布完成融资。", eventDate: null, entities: ["甲公司"], status: "reported", sourceUrls: [unreadUrl] }, coverage), true, "有来源且包含明确动作的无日期线索可以保留为待核实项");

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
          { headline: "甲公司确认事项", summary: "公告支持。", eventDate: "2026-08-06", eventType: "融资", entities: ["投资方A", "甲公司"], status: "confirmed", sourceUrls: [readUrl] },
          { headline: "乙公司推进融资事项", summary: "媒体报道乙公司宣布推进融资，尚待核实。", eventDate: "2026-08-08", entities: ["乙公司"], status: "confirmed", sourceUrls: [unreadUrl] },
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
  assert.equal(result.importantFacts[0]?.eventDate, "2026-08-06", "事件日必须独立保留");
  assert.equal(result.importantFacts[0]?.eventDateSupport, "evidence", "精确事件日必须带正文证据支持标记");
  assert.equal(result.importantFacts[0]?.publishedAt?.startsWith("2026-08-07"), true, "发布日期必须来自来源而非事件日");
  assert.equal(result.importantFacts[0]?.publishedAt, "2026-08-07T01:30:00.000Z", "正文 datePublished 应优先于供应商日期");
  assert.equal(result.importantFacts[0]?.publishedAtSource, "evidence");
  assert.equal(result.importantFacts[0]?.publishedAtConfidence, "high");
  assert.equal(result.sourceList.find((item) => item.url === readUrl)?.publishedAtSource, "evidence");
  assert.equal(result.importantFacts[0]?.eventType, "融资");
  assert.equal(result.otherItems.length, 1, "only sourced, concrete current-window clues remain visible");
  assert.equal(result.report.items[1]?.status, "reported", "confirmed without a successful read must be downgraded, not deleted");
  assert.equal(result.report.items.find((item) => item.headline === "池外来源事项")?.sourceUrls.length, 0, "URLs outside the search pool must be removed");
  assert.ok(!result.importantFacts.some((item) => item.title === "历史背景") && !result.otherItems.some((item) => item.title === "历史背景"), "context must not become a current-event card");
  assert.equal(result.trendSignals.length, 0);
  assert.equal(result.retrieval.sources.find((source) => source.url === readUrl)?.evidenceStatus, "full");
  assert.equal(result.retrieval.sources.find((source) => source.url === unreadUrl)?.evidenceStatus, "not_selected", "未取证来源必须与取证失败区分");
  assert.equal(result.telemetry.provider, "synthetic-agent");
  assert.equal(result.telemetry.model, "synthetic-model");
  assert.equal(result.telemetry.finalization, "direct");
  assert.equal(result.telemetry.finalRepairAttempted, false);
  assert.equal(result.telemetry.finalRepairSucceeded, false);
  assert.doesNotMatch(JSON.stringify(result.telemetry), /must never enter telemetry|hidden/);

  let malformedToolTurn = 0;
  const malformedToolProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn({ messages }) {
      malformedToolTurn++;
      if (malformedToolTurn === 1) {
        return {
          content: null,
          reasoningContent: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "malformed-search", type: "function", function: { name: "web_search", arguments: '{"queries":["产业事项"' } }],
        };
      }
      if (malformedToolTurn === 2) {
        const assistant = [...messages].reverse().find((message) => message.role === "assistant");
        if (!assistant || assistant.role !== "assistant" || !assistant.tool_calls?.[0]) throw new Error("normalized assistant tool call missing");
        const normalizedArguments = assistant.tool_calls[0].function.arguments;
        assert.doesNotThrow(() => JSON.parse(normalizedArguments), "下一轮不得回传供应商产生的非法 function.arguments");
        assert.deepEqual(JSON.parse(normalizedArguments), {});
        const toolError = messages.find((message) => message.role === "tool" && message.tool_call_id === "malformed-search");
        assert.match(String(toolError?.content), /invalid_tool_arguments/);
        return toolCall("web_search", { queries: ["产业事项"] }, "valid-search-after-malformed");
      }
      return {
        content: JSON.stringify({ answer: "已安全跳过损坏的工具参数，并完成有效检索。", items: [], searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low" }),
        reasoningContent: null,
        toolCalls: [],
      };
    },
  };
  const malformedRecovered = await runAiNativeResearch(input, coverage, { generationProvider: malformedToolProvider, retrieval: retrieval(), acquireEvidence: acquire });
  assert.equal(malformedRecovered.report.answer, "已安全跳过损坏的工具参数，并完成有效检索。");
  assert.equal(malformedRecovered.telemetry.turns.some((item) => item.invalidReason === "INVALID_TOOL_ARGUMENTS"), true);

  const brief = buildAiNativeBriefResult(input, coverage, new Date("2026-08-09T12:00:00.000Z"), provider, result);
  assert.equal(brief.metadata.overview, directAnswer, "BriefResult must use report.answer without a second rewrite");
  assert.equal(brief.metadata.research?.mode, "ai-native");
  assert.equal(brief.metadata.generationModel, "synthetic-model");
  assert.notEqual(brief.metadata.overview, "本期未发现符合条件、且可核验的新增事实。");
  const partialEmptyBrief = buildAiNativeBriefResult(input, coverage, new Date("2026-08-09T12:00:00.000Z"), provider, {
    ...result,
    report: { ...result.report, answer: "目前无 confirmed 证据。" },
    importantFacts: [],
    otherItems: [],
    retrieval: { ...result.retrieval, status: "partial", final: { facts: 0, clues: 0, trends: 0 } },
  });
  assert.match(partialEmptyBrief.metadata.overview, /不代表.*不存在相关事件/, "AI-native 部分检索的空结果必须覆盖模型的错误否定结论");
  assert.doesNotMatch(partialEmptyBrief.metadata.overview, /无 confirmed 证据/);
  assert.equal(partialEmptyBrief.metadata.research?.mode, "ai-native");
  if (partialEmptyBrief.metadata.research?.mode === "ai-native") {
    assert.equal(partialEmptyBrief.metadata.research.report.answer, partialEmptyBrief.metadata.overview, "API 可见的 research.report.answer 必须与安全 overview 同步");
    assert.doesNotMatch(partialEmptyBrief.metadata.research.report.answer, /无 confirmed 证据/);
  }
  const partialWithItemsBrief = buildAiNativeBriefResult(input, coverage, new Date("2026-08-09T12:00:00.000Z"), provider, {
    ...result,
    retrieval: { ...result.retrieval, status: "partial" },
  });
  assert.match(partialWithItemsBrief.metadata.overview, /^本次仅完成部分来源检索/);
  assert.match(partialWithItemsBrief.metadata.overview, /甲公司事项已有原文支持/, "部分失败不能丢弃已有成果");

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

  let deepSeekInvalidTurn = 0;
  let deepSeekInvalidRepairCalls = 0;
  let deepSeekInvalidForcedCalls = 0;
  const deepSeekInvalidProvider: IntelligenceProvider = {
    ...provider,
    id: "deepseek",
    async runAgentTurn() {
      deepSeekInvalidTurn++;
      if (deepSeekInvalidTurn === 1) return toolCall("web_search", { queries: ["产业事项"] }, "search-deepseek-invalid");
      if (deepSeekInvalidTurn === 2) return toolCall("read_url", { urls: [readUrl] }, "read-deepseek-invalid");
      return { content: `broken-deepseek-final-${"x".repeat(12_000)}`, reasoningContent: null, toolCalls: [], finishReason: "stop" };
    },
    async generate({ system, prompt, phase, responseFormat, maxOutputTokens }) {
      if (system.includes("Final JSON Repair")) {
        deepSeekInvalidRepairCalls++;
        throw new Error("DeepSeek invalid JSON must not enter model repair");
      }
      assert.equal(phase, "forced-finalization");
      assert.doesNotMatch(prompt, /broken-deepseek-final/, "forced finalization 必须使用有界 source/evidence，不回放损坏原文");
      assert.equal(responseFormat, "json_object", "DeepSeek forced finalization 必须启用官方 JSON Output");
      assert.equal(maxOutputTokens, 4_096);
      assert.match(prompt, /items 最多 5 项/);
      deepSeekInvalidForcedCalls++;
      return JSON.stringify({ answer: "DeepSeek 有界重新成稿。", items: [], searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low" });
    },
  };
  const deepSeekInvalid = await runAiNativeResearch(input, coverage, { generationProvider: deepSeekInvalidProvider, retrieval: retrieval(), acquireEvidence: acquire });
  assert.equal(deepSeekInvalid.report.answer, "DeepSeek 有界重新成稿。");
  assert.equal(deepSeekInvalid.telemetry.finalization, "forced");
  assert.equal(deepSeekInvalid.telemetry.finalRepairAttempted, false);
  assert.equal(deepSeekInvalidRepairCalls, 0);
  assert.equal(deepSeekInvalidForcedCalls, 1);
  assert.equal(deepSeekInvalidTurn + deepSeekInvalidForcedCalls, 4, "三轮研究后只能有一次最终成稿");

  const deepSeekForcedFailure = async (mode: "invalid" | "truncated") => {
    let turns = 0;
    let forcedCalls = 0;
    const phases: string[] = [];
    const failingProvider: IntelligenceProvider = {
      ...provider,
      id: "deepseek",
      async runAgentTurn(request) {
        turns++;
        phases.push(request.phase || "missing");
        if (turns === 1) return toolCall("web_search", { queries: ["产业事项"] }, `failure-search-${mode}`);
        if (turns === 2) return toolCall("read_url", { urls: [readUrl] }, `failure-read-${mode}`);
        return { content: "invalid-third-turn", reasoningContent: null, toolCalls: [], finishReason: "stop" };
      },
      async generate(request) {
        forcedCalls++;
        phases.push(request.phase || "missing");
        assert.equal(request.responseFormat, "json_object");
        if (mode === "truncated") throw new AICompletionTruncatedError();
        return "not-json";
      },
    };
    await assert.rejects(
      runAiNativeResearch(input, coverage, { generationProvider: failingProvider, retrieval: retrieval(), acquireEvidence: acquire }),
      /AI_NATIVE_FINALIZATION_FAILED/,
    );
    assert.equal(turns, 3);
    assert.equal(forcedCalls, 1, `${mode} 最终成稿失败后不得追加调用`);
    assert.deepEqual(phases, ["research-agent-turn-1", "research-agent-turn-2", "research-agent-turn-3", "forced-finalization"]);
  };
  await deepSeekForcedFailure("invalid");
  await deepSeekForcedFailure("truncated");

  let truncatedTurn = 0;
  let truncatedRepairCalls = 0;
  let truncatedForcedCalls = 0;
  let truncatedSearchCalls = 0;
  const truncatedProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn() {
      truncatedTurn++;
      if (truncatedTurn === 1) return toolCall("web_search", { queries: ["产业事项"] }, "search-truncated");
      return { content: JSON.stringify({ answer: "不完整的最终输出", items: [] }), reasoningContent: null, toolCalls: [], finishReason: "length" };
    },
    async generate({ system, phase }) {
      if (system.includes("Final JSON Repair")) {
        truncatedRepairCalls++;
        throw new Error("截断文本不得进入 JSON repair");
      }
      assert.equal(phase, "forced-finalization");
      truncatedForcedCalls++;
      return JSON.stringify({ answer: "基于有界来源重新形成的完整输出。", items: [], searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low" });
    },
  };
  const truncated = await runAiNativeResearch(input, coverage, {
    generationProvider: truncatedProvider,
    retrieval: { async retrieve(request) { truncatedSearchCalls++; return retrieval().retrieve(request); } },
    acquireEvidence: acquire,
  });
  assert.equal(truncated.report.answer, "基于有界来源重新形成的完整输出。", "finish_reason=length 的最终文本不得直接发布");
  assert.equal(truncated.telemetry.turns.some((item) => item.invalidReason === "TRUNCATED_FINAL_OUTPUT"), true);
  assert.equal(truncated.telemetry.finalization, "forced");
  assert.equal(truncated.telemetry.finalRepairAttempted, false);
  assert.equal(truncatedRepairCalls, 0, "截断输出缺少尾部内容，不得进入无法恢复缺失事实的 JSON repair");
  assert.equal(truncatedForcedCalls, 1, "截断后必须使用预留调用和有界 source/evidence 重新成稿");
  assert.equal(truncatedSearchCalls, 1, "截断修复不得增加检索调用");

  let truncatedToolRetrievalCalls = 0;
  const truncatedToolProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn() { return { ...toolCall("web_search", { queries: ["不得执行"] }, "truncated-tool"), finishReason: "length" }; },
    async generate({ system }) {
      if (system.includes("Final JSON Repair")) throw new Error("tool truncation has no direct final to repair");
      return JSON.stringify({ answer: "未执行截断工具参数。", items: [], searchedAreas: [], unresolvedGaps: ["工具参数被截断"], confidence: "low" });
    },
  };
  await assert.rejects(runAiNativeResearch(input, coverage, {
    generationProvider: truncatedToolProvider,
    retrieval: { async retrieve(request) { truncatedToolRetrievalCalls++; return retrieval().retrieve(request); } },
    acquireEvidence: acquire,
  }), /AI_NATIVE_SEARCH_FAILED/, "未执行截断工具且没有检索结果时应显式失败，而不是发布空成功");
  assert.equal(truncatedToolRetrievalCalls, 0, "finish_reason=length 的工具参数不得执行");

  const officialB2Url = "https://official.example/2026-08-08/b2";
  const mediaB2Url = "https://media.example/2026-08-08/b2-report";
  const mediaBPlusUrl = "https://media.example/2026-08-08/b-plus";
  const oldReviewUrl = "https://review.example/2023-12-31/roundup";
  const controlledItems = [
    { headline: "甲机器人公司完成B2轮融资", summary: "官网披露完成B2轮融资。", eventDate: "2026-08-08", eventType: "融资", entities: ["甲机器人公司"], status: "confirmed", sourceUrls: [mediaB2Url, officialB2Url] },
    { headline: "甲机器人公司B2轮融资落地", summary: "媒体报道同一笔B2轮融资，并引用公司官网。", eventDate: "2026-08-08", eventType: "融资", entities: ["甲机器人公司"], status: "confirmed", sourceUrls: [mediaB2Url, officialB2Url] },
    { headline: "甲机器人公司完成B+轮融资", summary: "媒体说法尚待官网确认。", eventDate: "2026-08-08", eventType: "融资", entities: ["甲机器人公司"], status: "reported", sourceUrls: [mediaBPlusUrl] },
    { headline: "机器人行业2023年融资盘点", summary: "历史行业盘点。", eventDate: "2023-12-31", eventType: "融资", entities: [], status: "context", sourceUrls: [oldReviewUrl] },
  ];
  const runControlledTransport = async (order: number[]) => {
    let adapterCalls = 0;
    const controlledAdapter = new BailianRetrievalProvider({
      apiKey: "local-test-key",
      endpoint: "https://transport.invalid/dashscope",
      fetchImpl: async () => {
        adapterCalls++;
        return new Response(JSON.stringify({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "受控检索结果" }] } }] }, search_info: { search_results: [
          { title: "甲机器人公司完成B2轮融资", url: officialB2Url, snippet: "公司官网披露完成B2轮融资。", source: "公司官网", published_at: "2026-08-08" },
          { title: "甲机器人公司B2轮融资落地", url: mediaB2Url, snippet: "媒体报道同一笔B2轮融资。", source: "财经媒体", published_at: null },
          { title: "甲机器人公司完成B+轮融资", url: mediaBPlusUrl, snippet: "媒体称完成B+轮融资，尚待确认。", source: "财经媒体", published_at: "2026-08-08" },
          { title: "机器人行业2023年融资盘点", url: oldReviewUrl, snippet: "2023年行业累计多家企业融资。", source: "行业媒体", published_at: "2023-12-31" },
        ] } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    let controlledTurn = 0;
    const controlledAgent: IntelligenceProvider = {
      id: "controlled-ai-native",
      capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
      async runAgentTurn() {
        controlledTurn++;
        if (controlledTurn === 1) return toolCall("web_search", { queries: ["机器人企业融资"] }, "controlled-search");
        if (controlledTurn === 2) return toolCall("read_url", { urls: [mediaB2Url, officialB2Url, mediaBPlusUrl] }, "controlled-read");
        return { content: JSON.stringify({ answer: "甲机器人公司于2026年8月8日完成B2轮融资；甲机器人公司于2026年8月8日完成B+轮融资的说法仍待核实。", items: order.map((index) => controlledItems[index]), searchedAreas: ["机器人企业融资"], unresolvedGaps: ["B+轮说法"], confidence: "medium" }), reasoningContent: null, toolCalls: [], finishReason: "stop" };
      },
      async generate() { throw new Error("controlled direct finalization must not invoke repair"); },
    };
    const result = await runAiNativeResearch(input, coverage, {
      generationProvider: controlledAgent,
      retrieval: new IntelligenceRetrievalOrchestrator([], [controlledAdapter]),
      acquireEvidence: (async (candidates: any[]) => {
        for (const candidate of candidates) {
          candidate.content = candidate.sourceUrl === mediaBPlusUrl ? "媒体称完成B+轮融资，尚待官网确认。" : "甲机器人公司于2026年8月8日完成B2轮融资。";
          candidate.evidenceStatus = candidate.sourceUrl === officialB2Url ? "full" : "unavailable";
          if (candidate.evidenceStatus === "unavailable") candidate.evidenceFailureReason = "fixture_timeout";
          if (candidate.sourceUrl === officialB2Url) candidate.evidencePublishedAt = "2026-08-08T08:30:00+08:00";
        }
        return { candidates, stats: { attempted: candidates.length, full: 1, partial: 0, unavailable: 2 } };
      }) as any,
    });
    assert.equal(adapterCalls, 1, "每个排列的可控百炼 transport 到最终卡片只允许一次检索请求");
    return result;
  };
  const controlledResult = await runControlledTransport([0, 1, 2, 3]);
  const reversedControlledResult = await runControlledTransport([1, 0, 2, 3]);
  assert.equal(controlledResult.importantFacts.length, 1, "同一B2事件的官网与转载必须在真实AI-native卡片路径确定性去重");
  assert.equal(controlledResult.otherItems.length, 1, "与官网B2冲突且无正文证据的B+报道必须保留为独立线索");
  assert.equal(controlledResult.importantFacts[0]?.sourceUrl, officialB2Url, "主来源 URL 必须与正文发布日期证据相同");
  assert.equal(controlledResult.importantFacts[0]?.source, "公司官网");
  assert.equal(controlledResult.importantFacts[0]?.publishedAt, "2026-08-08T00:30:00.000Z");
  assert.equal(controlledResult.importantFacts[0]?.publishedAtSource, "evidence");
  assert.equal(controlledResult.importantFacts[0]?.eventDate, "2026-08-08", "B2 日期必须由 B2 正文证据保留");
  assert.deepEqual(new Set(controlledResult.importantFacts[0]?.sourceUrls), new Set([mediaB2Url, officialB2Url]), "去重后仍须保留全部B2来源");
  assert.match(controlledResult.otherItems[0]?.title || "", /B\+轮/);
  assert.equal(controlledResult.otherItems[0]?.isClue, true);
  assert.equal(controlledResult.otherItems[0]?.eventDate, undefined, "同主体 B2 的已证实日期不能借给无正文证据的 B+ 事件");
  assert.match(controlledResult.report.answer, /2026年8月8日完成B2轮融资/);
  assert.match(controlledResult.report.answer, /事件日期未确认完成B\+轮融资/, "最终 answer 必须按事件校验，不能使用全报告日期白名单");
  assert.deepEqual(controlledResult.importantFacts[0]?.conflicts?.[0], {
    type: "financing-round", reason: "same-entity-near-date-different-round", entity: "甲机器人公司", values: ["B+", "B2"], relatedSourceUrls: [mediaB2Url, mediaBPlusUrl, officialB2Url].sort(),
  }, "近日期同主体的轮次矛盾必须形成机器可验证冲突元数据");
  assert.deepEqual(reversedControlledResult.importantFacts.map(({ source, sourceUrl, publishedAt, evidenceStatus, kind, isClue, conflicts }) => ({ source, sourceUrl, publishedAt, evidenceStatus, kind, isClue, conflicts })), controlledResult.importantFacts.map(({ source, sourceUrl, publishedAt, evidenceStatus, kind, isClue, conflicts }) => ({ source, sourceUrl, publishedAt, evidenceStatus, kind, isClue, conflicts })), "同层级、不同证据、缺日期的输入反序不得改变最终事实主来源或证据状态");
  assert.equal(controlledResult.importantFacts.some((item) => item.title.includes("2023")), false, "旧盘点不得进入本期事实卡");
  assert.equal(controlledResult.retrieval.sources.find((source) => source.url === mediaB2Url)?.evidenceStatus, "unavailable");
  assert.equal(controlledResult.retrieval.sources.find((source) => source.url === mediaB2Url)?.exclusionReason, "fixture_timeout", "取证失败原因必须作为安全结构化诊断保留");

  // 从真实 AI-native adapter 编排到 Brief API/UI 数据的事件角色回归：日期前置、
  // 交易对手、同句多事件与不可靠别名都必须使用同一套事件级证据门禁。
  const roleFinanceUrl = "https://official.example/2024-01-22/finance";
  const roleAcquisitionUrl = "https://official.example/2024-03-04/acquisition";
  const roleInvestmentUrl = "https://official.example/2024-04-06/investment";
  const rolePlannedAcquisitionUrl = "https://official.example/2024-08-01/planned-acquisition";
  const roleCrossSentenceUrl = "https://official.example/2024-07-09/cross-sentence";
  const roleAmbiguousUrl = "https://media.example/2024-05-09/multiple-events";
  const roleEvidence = new Map([
    [roleFinanceUrl, "2024年1月22日，甲机器人公司完成B2轮融资。"],
    [roleAcquisitionUrl, "甲机器人公司于2024年3月4日收购乙科技有限公司并完成交割。"],
    [roleInvestmentUrl, "投资方甲资本于2024年4月6日投资乙科技有限公司。"],
    [rolePlannedAcquisitionUrl, "戊公司于2024年1月22日完成B2轮融资并计划于2024年下半年收购己公司。"],
    [roleCrossSentenceUrl, "庚公司完成B2轮融资。庚公司于2024年7月9日收购辛公司。壬公司于2024年3月4日收购寅公司10%股权；壬公司于2024年3月6日收购卯公司；壬公司于2024年6月8日再次收购寅公司20%股权。"],
    [roleAmbiguousUrl, "2024年5月7日，丁公司完成B2轮融资，并丙公司于2024年5月9日完成收购。"],
  ]);
  let roleAdapterCalls = 0;
  const roleAdapter = new BailianRetrievalProvider({
    apiKey: "local-role-fixture-key",
    endpoint: "https://transport.invalid/dashscope",
    fetchImpl: async () => {
      roleAdapterCalls++;
      return new Response(JSON.stringify({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "离线事件角色回放" }] } }] }, search_info: { search_results: [
        { title: "甲机器人公司完成B2轮融资", url: roleFinanceUrl, snippet: roleEvidence.get(roleFinanceUrl), source: "公司公告", published_at: "2024-01-23" },
        { title: "甲机器人公司收购乙科技有限公司", url: roleAcquisitionUrl, snippet: roleEvidence.get(roleAcquisitionUrl), source: "公司公告", published_at: "2024-03-05" },
        { title: "乙科技有限公司获得投资方甲资本投资", url: roleInvestmentUrl, snippet: roleEvidence.get(roleInvestmentUrl), source: "公司公告", published_at: "2024-04-07" },
        { title: "戊公司完成融资并计划收购己公司", url: rolePlannedAcquisitionUrl, snippet: roleEvidence.get(rolePlannedAcquisitionUrl), source: "公司公告", published_at: "2024-08-01" },
        { title: "庚公司收购辛公司", url: roleCrossSentenceUrl, snippet: roleEvidence.get(roleCrossSentenceUrl), source: "公司公告", published_at: "2024-07-10" },
        { title: "两家公司披露不同资本事件", url: roleAmbiguousUrl, snippet: roleEvidence.get(roleAmbiguousUrl), source: "财经媒体", published_at: "2024-05-10" },
      ] } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  let roleTurn = 0;
  const roleAgent: IntelligenceProvider = {
    id: "controlled-event-role-provider",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      roleTurn++;
      if (roleTurn === 1) return toolCall("web_search", { queries: ["2024 企业投融资并购"] }, "role-search");
      if (roleTurn === 2) return toolCall("read_url", { urls: [...roleEvidence.keys()] }, "role-read");
      return { content: JSON.stringify({
        answer: "2024年1月22日，甲机器人公司完成B2轮融资。甲机器人公司于2024年3月4日收购乙科技有限公司。投资方甲资本于2024年4月6日投资乙科技有限公司。戊公司于2024年1月22日完成B2轮融资并计划于2024年下半年收购己公司。庚公司于2024年7月9日收购辛公司。壬公司于2024年3月4日收购寅公司，2024年3月6日收购卯公司，并于2024年6月8日再次收购寅公司。壬公司于2024年3月4日收购寅公司和卯公司。丙公司于2024年5月7日完成收购。",
        items: [
          { headline: "甲机器人公司完成B2轮融资", summary: "2024年1月22日，甲机器人公司完成B2轮融资。", eventDate: "2024-01-22", eventType: "融资", entities: ["投资方甲资本", "甲机器人公司"], status: "confirmed", sourceUrls: [roleFinanceUrl] },
          { headline: "甲机器人公司收购乙科技有限公司", summary: "甲机器人公司收购乙科技有限公司并完成交割。", eventDate: "2024-03-04", eventType: "收购", entities: ["甲机器人公司", "乙科技有限公司"], status: "confirmed", sourceUrls: [roleAcquisitionUrl] },
          { headline: "乙科技有限公司获得投资方甲资本投资", summary: "投资方甲资本投资乙科技有限公司。", eventDate: "2024-04-06", eventType: "投资", entities: ["乙科技有限公司", "投资方甲资本"], status: "confirmed", sourceUrls: [roleInvestmentUrl] },
          { headline: "戊公司完成B2轮融资", summary: "戊公司完成B2轮融资。", eventDate: "2024-01-22", eventType: "融资", entities: ["戊公司"], status: "confirmed", sourceUrls: [rolePlannedAcquisitionUrl] },
          { headline: "戊公司计划收购己公司", summary: "戊公司计划于2024年下半年收购己公司。", eventDate: "2024-01-22", eventType: "收购", entities: ["戊公司", "己公司"], status: "reported", sourceUrls: [rolePlannedAcquisitionUrl] },
          { headline: "庚公司收购辛公司", summary: "庚公司收购辛公司。", eventDate: "2024-07-09", eventType: "收购", entities: ["庚公司", "辛公司"], status: "confirmed", sourceUrls: [roleCrossSentenceUrl] },
          { headline: "壬公司收购寅公司10%股权", summary: "壬公司收购寅公司10%股权。", eventDate: "2024-03-04", eventType: "收购", entities: ["壬公司", "寅公司"], status: "confirmed", sourceUrls: [roleCrossSentenceUrl] },
          { headline: "壬公司收购卯公司", summary: "壬公司收购卯公司。", eventDate: "2024-03-06", eventType: "收购", entities: ["壬公司", "卯公司"], status: "confirmed", sourceUrls: [roleCrossSentenceUrl] },
          { headline: "壬公司再次收购寅公司20%股权", summary: "壬公司再次收购寅公司20%股权。", eventDate: "2024-06-08", eventType: "收购", entities: ["壬公司", "寅公司"], status: "confirmed", sourceUrls: [roleCrossSentenceUrl] },
          { headline: "丙公司完成收购", summary: "丙公司完成收购。", eventDate: "2024-05-07", eventType: "收购", entities: ["丙公司"], status: "reported", sourceUrls: [roleAmbiguousUrl] },
        ],
        searchedAreas: ["企业投融资并购"], unresolvedGaps: ["丙公司事件日"], confidence: "medium",
      }), reasoningContent: null, toolCalls: [], finishReason: "stop" };
    },
    async generate() { throw new Error("event-role replay must not invoke repair"); },
  };
  const roleInput = normalizeTaskInput({ name: "2024 企业投融资并购", keywords: ["融资", "收购"], maxItems: 20, lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" }, outputInstructions: "形成事件简报。", isActive: true });
  const roleCoverage = { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z") };
  const roleResult = await runAiNativeResearch(roleInput, roleCoverage, {
    generationProvider: roleAgent,
    retrieval: new IntelligenceRetrievalOrchestrator([], [roleAdapter]),
    acquireEvidence: (async (candidates: any[]) => ({
      candidates: candidates.map((candidate) => Object.assign(candidate, { content: roleEvidence.get(candidate.sourceUrl) || candidate.content, evidenceStatus: "full" as const })),
      stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
    })) as any,
  });
  const roleBrief = buildAiNativeBriefResult(roleInput, roleCoverage, new Date("2024-12-31T23:59:59.999Z"), roleAgent, roleResult);
  const roleItems = [...roleBrief.importantFacts, ...roleBrief.otherItems];
  const financeItem = roleItems.find((item) => item.title.includes("B2轮融资"));
  const acquisitionItem = roleItems.find((item) => item.title.includes("收购乙科技"));
  const investmentItem = roleItems.find((item) => item.title.includes("获得投资方"));
  const plannedAcquisitionItem = roleItems.find((item) => item.title.includes("戊公司计划收购"));
  const crossSentenceItem = roleItems.find((item) => item.title.includes("庚公司收购"));
  const multipleDealItems = roleItems.filter((item) => item.title.includes("壬公司"));
  const ambiguousItem = roleItems.find((item) => item.title.includes("丙公司"));
  assert.equal(roleAdapterCalls, 1, "事件角色回归只能使用一次受控 adapter 请求");
  assert.equal(financeItem?.eventDate, "2024-01-22", "日期前置的融资证据必须贯通到 Brief API 数据");
  assert.match(intelligenceEventTimeLabel(financeItem!), /事件日/, "UI 数据应显示已证实事件日");
  assert.equal(acquisitionItem?.eventDate, "2024-03-04", "收购方与交易对手必须绑定为同一并购事件");
  assert.equal(investmentItem?.eventDate, "2024-04-06", "投资方与被投企业必须绑定为同一投资事件");
  assert.ok(plannedAcquisitionItem, `计划收购卡必须保留：${roleItems.map((item) => item.title).join(" | ")}`);
  assert.equal(plannedAcquisitionItem?.eventDate, undefined, "已完成融资的日期不能借给同句后续计划收购");
  assert.equal(plannedAcquisitionItem?.eventTimeText, "2024年下半年", "计划收购有依据的模糊时间仍须保留");
  assert.match(intelligenceEventTimeLabel(plannedAcquisitionItem!), /2024年下半年.*未精确到日/, "UI 必须把计划收购显示为模糊时间而非融资日");
  assert.equal(crossSentenceItem?.eventDate, "2024-07-09", "跨句证据应只使用包含目标动作与日期的句子");
  assert.equal(multipleDealItems.length, 3, "同一URL中的不同标的或不同事件日不得被并购主题去重吞并");
  assert.deepEqual(multipleDealItems.map((item) => item.eventDate).sort(), ["2024-03-04", "2024-03-06", "2024-06-08"]);
  assert.equal(ambiguousItem?.eventDate, undefined, "同句前一事件的日期不得借给后一主体");
  assert.match(roleResult.report.answer, /2024年1月22日，甲机器人公司完成B2轮融资/);
  assert.match(roleResult.report.answer, /2024年3月4日收购乙科技有限公司/);
  assert.match(roleResult.report.answer, /2024年4月6日投资乙科技有限公司/);
  assert.match(roleResult.report.answer, /戊公司于2024年1月22日完成B2轮融资并计划于2024年下半年收购己公司/, "最终 answer 应保留融资日与收购模糊时间各自的语义");
  assert.match(roleResult.report.answer, /庚公司于2024年7月9日收购辛公司/);
  assert.match(roleResult.report.answer, /壬公司于事件日期未确认收购寅公司和卯公司/, "同主体、同事件族但多个交易对象并列时不得借用其中一笔的日期");
  assert.match(roleResult.report.answer, /丙公司于事件日期未确认完成收购/, "最终 answer 也必须按事件角色安全降级");

  // 同一交易的不同语序应合并；不同标的或不同事件日仍保持独立。
  const dedupeOfficialUrl = "https://official.example/2024-03-04/deal";
  const dedupeMediaUrl = "https://media.example/2024-03-20/same-deal";
  const dedupeOtherTargetUrl = "https://official.example/2024-03-04/other-target";
  const dedupeLaterDealUrl = "https://official.example/2024-06-08/later-deal";
  const dedupeEvidence = new Map([
    [dedupeOfficialUrl, "甲公司于2024年3月4日收购乙公司。"],
    [dedupeMediaUrl, "甲公司于2024年3月4日完成对乙公司的收购。"],
    [dedupeOtherTargetUrl, "甲公司于2024年3月4日收购丙公司。"],
    [dedupeLaterDealUrl, "甲公司于2024年6月8日再次收购乙公司。"],
  ]);
  let dedupeAdapterCalls = 0;
  const dedupeAdapter = new BailianRetrievalProvider({
    apiKey: "local-dedupe-fixture-key",
    endpoint: "https://transport.invalid/dashscope",
    fetchImpl: async () => {
      dedupeAdapterCalls++;
      return new Response(JSON.stringify({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "离线交易去重回放" }] } }] }, search_info: { search_results: [
        { title: "甲公司收购乙公司", url: dedupeOfficialUrl, snippet: dedupeEvidence.get(dedupeOfficialUrl), source: "公司公告", published_at: "2024-03-05" },
        { title: "甲公司完成对乙公司的收购", url: dedupeMediaUrl, snippet: dedupeEvidence.get(dedupeMediaUrl), source: "财经媒体", published_at: "2024-03-20" },
        { title: "甲公司收购丙公司", url: dedupeOtherTargetUrl, snippet: dedupeEvidence.get(dedupeOtherTargetUrl), source: "公司公告", published_at: "2024-03-05" },
        { title: "甲公司再次收购乙公司", url: dedupeLaterDealUrl, snippet: dedupeEvidence.get(dedupeLaterDealUrl), source: "公司公告", published_at: "2024-06-09" },
      ] } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  let dedupeTurn = 0;
  const dedupeAgent: IntelligenceProvider = {
    id: "controlled-event-dedupe-provider",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      dedupeTurn++;
      if (dedupeTurn === 1) return toolCall("web_search", { queries: ["甲公司 2024 收购"] }, "dedupe-search");
      if (dedupeTurn === 2) return toolCall("read_url", { urls: [...dedupeEvidence.keys()] }, "dedupe-read");
      return { content: JSON.stringify({
        answer: "甲公司于2024年3月4日收购乙公司并收购丙公司，随后于2024年6月8日再次收购乙公司。",
        items: [
          { headline: "甲公司收购乙公司", summary: "甲公司收购乙公司。", eventDate: "2024-03-04", eventType: "收购", entities: ["甲公司", "乙公司"], status: "confirmed", sourceUrls: [dedupeOfficialUrl] },
          { headline: "甲公司完成对乙公司的收购", summary: "甲公司完成对乙公司的收购。", eventDate: "2024-03-04", eventType: "收购", entities: ["甲公司", "乙公司"], status: "confirmed", sourceUrls: [dedupeMediaUrl] },
          { headline: "甲公司收购丙公司", summary: "甲公司收购丙公司。", eventDate: "2024-03-04", eventType: "收购", entities: ["甲公司", "丙公司"], status: "confirmed", sourceUrls: [dedupeOtherTargetUrl] },
          { headline: "甲公司再次收购乙公司", summary: "甲公司再次收购乙公司。", eventDate: "2024-06-08", eventType: "收购", entities: ["甲公司", "乙公司"], status: "confirmed", sourceUrls: [dedupeLaterDealUrl] },
        ], searchedAreas: ["并购"], unresolvedGaps: [], confidence: "high",
      }), reasoningContent: null, toolCalls: [], finishReason: "stop" };
    },
    async generate() { throw new Error("event-dedupe replay must not invoke repair"); },
  };
  const dedupeInput = normalizeTaskInput({ name: "甲公司2024并购", keywords: ["收购"], maxItems: 10, lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" }, outputInstructions: "形成并购简报。", isActive: true });
  const dedupeCoverage = { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z") };
  const dedupeResult = await runAiNativeResearch(dedupeInput, dedupeCoverage, {
    generationProvider: dedupeAgent,
    retrieval: new IntelligenceRetrievalOrchestrator([], [dedupeAdapter]),
    acquireEvidence: (async (candidates: any[]) => ({
      candidates: candidates.map((candidate) => Object.assign(candidate, { content: dedupeEvidence.get(candidate.sourceUrl) || candidate.content, evidenceStatus: "full" as const })),
      stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
    })) as any,
  });
  const dedupeCards = [...dedupeResult.importantFacts, ...dedupeResult.otherItems];
  const sameDeal = dedupeCards.filter((item) => item.eventDate === "2024-03-04" && item.title.includes("乙公司"));
  assert.equal(dedupeAdapterCalls, 1, "交易去重回归只允许一次受控 adapter 请求");
  assert.equal(dedupeCards.length, 3, "同交易不同表述合并后，不同标的和不同日期仍应独立");
  assert.equal(sameDeal.length, 1, "甲公司收购乙公司与完成对乙公司的收购应归一为同一事件");
  assert.deepEqual(new Set(sameDeal[0]?.sourceUrls), new Set([dedupeOfficialUrl, dedupeMediaUrl]));
  assert.ok(dedupeCards.some((item) => item.title.includes("丙公司") && item.eventDate === "2024-03-04"));
  assert.ok(dedupeCards.some((item) => item.title.includes("乙公司") && item.eventDate === "2024-06-08"));

  // 2026-11-03 真实小样的公开结果离线回放：适配器返回三条实际命中，
  // 第二批官方来源查询被预算闸门拒绝。不得联网，也不得把模型猜测日期发布给用户。
  const replayNbdUrl = "https://www.nbd.com.cn/rss/sohu/articles/3253893.html";
  const replayBaaiUrl = "https://hub.baai.ac.cn/view/35340";
  const replayPhoenixUrl = "https://finance.ifeng.com/c/8XPAe5AQMlw";
  let replayAdapterCalls = 0;
  const replayAdapter = new BailianRetrievalProvider({
    apiKey: "local-replay-key",
    endpoint: "https://transport.invalid/dashscope",
    fetchImpl: async () => {
      replayAdapterCalls++;
      if (replayAdapterCalls > 1) return new Response(JSON.stringify({ message: "budget_exhausted" }), { status: 429, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "离线回放" }] } }] }, search_info: { search_results: [
        { title: "智能机器人公司宇树科技完成10亿元B2轮融资 美团参投", url: replayNbdUrl, snippet: "宇树科技于2024年春节前完成B2轮融资。", source: "每经网", published_at: null },
        { title: "宇树科技宣布完成近10亿元B2轮融资", url: replayBaaiUrl, snippet: "宇树科技于2024年春节前完成B2轮融资。", source: "北京智源人工智能研究院", published_at: null },
        { title: "10亿元！宇树科技完成B2轮融资", url: replayPhoenixUrl, snippet: "宇树科技于2024年春节前完成B2轮融资。", source: "凤凰网", published_at: "2024-02-23T02:19:25Z" },
      ] } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  let replayTurn = 0;
  const replayAgent: IntelligenceProvider = {
    id: "controlled-real-result-replay",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      replayTurn++;
      if (replayTurn === 1) return toolCall("web_search", { queries: ["宇树科技 2024年 B2轮 融资"] }, "replay-search-success");
      if (replayTurn === 2) return toolCall("web_search", { queries: ["宇树科技 B2轮 官方 公告"] }, "replay-search-budget");
      if (replayTurn === 3) return toolCall("read_url", { urls: [replayNbdUrl, replayBaaiUrl, replayPhoenixUrl] }, "replay-read");
      return { content: JSON.stringify({
        answer: "根据公开资料核查，宇树科技（Unitree Robotics）于2024年完成了一轮备受关注的B2轮融资，金额近10亿元人民币。该轮融资事件被多家媒体于2024年2月23日报道，援引信息称融资发生在“2024年春节前”，即2024年2月9日前，属于目标时间窗口内。尽管多篇报道内容高度一致，但目前尚未在宇树科技官网或权威工商变更记录中找到直接佐证，且部分提及C轮的信息发生于2025年及以后。因此，该B2轮融资事件具有较高可信度。Media reports corroborate the financing. However, currently no official company announcement was found.",
        items: [{ headline: "宇树科技完成近10亿元B2轮融资", summary: "宇树科技于January 22, 2024完成B2轮融资；尚未发现公司官网公告。", assessment: "若2024.1.22完成交割，则有助于研发投入，but no official company announcement was found.", eventDate: "2024-02-09", eventType: "融资", entities: ["美团", "宇树科技"], status: "reported", sourceUrls: [replayNbdUrl, replayBaaiUrl, replayPhoenixUrl] }],
        searchedAreas: ["2024年融资"], unresolvedGaps: ["公司官网公告"], confidence: "medium",
      }), reasoningContent: null, toolCalls: [], finishReason: "stop" };
    },
    async generate() { throw new Error("real-result replay must not invoke repair"); },
  };
  const replayInput = normalizeTaskInput({ ...input, name: "宇树科技2024年股权融资", lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" } });
  const replayCoverage = { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z") };
  const replayResult = await runAiNativeResearch(replayInput, replayCoverage, {
    generationProvider: replayAgent,
    retrieval: new IntelligenceRetrievalOrchestrator([], [replayAdapter]),
    acquireEvidence: (async (candidates: any[]) => {
      for (const candidate of candidates) {
        candidate.content = "甲公司于2024年1月22日完成另一笔融资，宇树科技则于2024年春节前完成B2轮融资，金额近10亿元人民币；资金用于产品研发、业务拓展和团队搭建。";
        candidate.evidenceStatus = candidate.sourceUrl === replayNbdUrl ? "partial" : "full";
        if (candidate.sourceUrl === replayPhoenixUrl) candidate.evidencePublishedAt = "2024-02-23T02:19:25Z";
      }
      return { candidates, stats: { attempted: candidates.length, full: 2, partial: 1, unavailable: 0 } };
    }) as any,
  });
  const replayBrief = buildAiNativeBriefResult(replayInput, replayCoverage, new Date("2026-11-03T00:00:00Z"), replayAgent, replayResult);
  assert.equal(replayAdapterCalls, 2, "真实结果回放必须包含一次成功检索和一次本地预算拒绝，不能联网重试");
  assert.equal(replayResult.retrieval.status, "partial");
  assert.equal(replayResult.otherItems.length, 1);
  assert.equal(replayResult.otherItems[0]?.eventDate, undefined, "正文未支持精确日期时必须删除模型猜测的事件日");
  assert.equal(replayResult.otherItems[0]?.eventDateSupport, undefined);
  assert.equal(replayResult.otherItems[0]?.eventTimeText, "2024年春节前", "正文中的模糊事件时间必须保留");
  assert.equal(intelligenceEventTimeLabel(replayResult.otherItems[0]!), "事件时间 2024年春节前（未精确到日）", "UI 必须显示模糊时间而非虚构日期");
  assert.doesNotMatch(`${replayResult.otherItems[0]?.summary || ""} ${replayResult.otherItems[0]?.investmentNote || ""}`, /1月22日|2024[-.]0?1[-.]22|January 22/i);
  assert.equal(replayResult.otherItems[0]?.publishedAt, "2024-02-23T02:19:25.000Z", "文章来源日期仍需独立保留");
  assert.doesNotMatch(replayBrief.metadata.overview, /尚未发现公司官网|no official company announcement|无公开工商|2024[-.]0?1[-.]22|January 22|2024年2月9日|事件日期未确认|春节前前|但目前。因此/i);
  assert.match(replayBrief.metadata.overview, /多家媒体于2024年2月23日报道/, "有来源支持且明确属于媒体报道语境的发布日期必须保留");
  assert.match(replayBrief.metadata.overview, /2024年春节前/, "模型猜测的精确日前关系应回退为正文支持的模糊时间");
  assert.match(replayBrief.metadata.overview, /多篇报道内容高度一致/);
  assert.match(replayBrief.metadata.overview, /Media reports corroborate the financing/);
  assert.match(replayBrief.metadata.overview, /官方来源、公告及后续事件尚未检索充分/);
  assert.doesNotMatch(`${replayBrief.otherItems[0]?.summary || ""} ${replayBrief.otherItems[0]?.investmentNote || ""}`, /尚未发现公司官网|no official company announcement/i, "partial 卡片的摘要和投资判断也必须清除覆盖性否定");
  assert.match(replayBrief.otherItems[0]?.summary || "", /宇树科技.*完成B2轮融资/, "清理否定从句时不能删除同字段的可靠融资事实");
  assert.equal(replayBrief.otherItems[0]?.summary, "宇树科技于2024年春节前完成B2轮融资。", "清理中文覆盖性否定后不得留下‘；。’等残缺标点");
  assert.equal(replayBrief.otherItems[0]?.investmentNote, "若2024年春节前完成交割，则有助于研发投入。", "清理英文覆盖性否定后中文事实必须使用完整句号");
  if (replayBrief.metadata.research?.mode === "ai-native") assert.equal(replayBrief.metadata.research.report.answer, replayBrief.metadata.overview, "API 次级路径不得泄漏错误日期或覆盖性否定");

  const crossEventPublication = enforceAiNativeEvidenceBackedDates({
    answer: "甲公司B2轮融资被媒体于2024年2月23日报道。乙公司战略融资被媒体于2024年2月23日报道。",
    items: [
      { headline: "甲公司完成B2轮融资", summary: "甲公司完成B2轮融资。", eventDate: null, eventType: "融资", entities: ["甲公司"], status: "reported", sourceUrls: ["https://media.example/a"] },
      { headline: "乙公司完成战略融资", summary: "乙公司完成战略融资。", eventDate: null, eventType: "融资", entities: ["乙公司"], status: "reported", sourceUrls: ["https://media.example/b"] },
    ],
    searchedAreas: [], unresolvedGaps: [], confidence: "medium",
  }, new Map([
    ["https://media.example/a", { evidenceStatus: "full", evidencePublishedAt: "2024-02-23T08:00:00+08:00", content: "甲公司完成B2轮融资。" }],
    ["https://media.example/b", { evidenceStatus: "full", evidencePublishedAt: "2024-03-01T08:00:00+08:00", content: "乙公司完成战略融资。" }],
  ]));
  assert.match(crossEventPublication.answer, /甲公司B2轮融资被媒体于2024年2月23日报道/);
  assert.doesNotMatch(crossEventPublication.answer, /乙公司战略融资被媒体于2024年2月23日报道/, "来源发布日期 proof 不得跨事件或跨来源借用");
  assert.equal((crossEventPublication.answer.match(/2024年2月23日/g) || []).length, 1, "只有日期与来源绑定的甲事件可保留该报道日");

  const sameRoundItems: AiNativeResearchReport["items"] = [
    { headline: "甲公司完成B2轮融资", summary: "甲公司完成B2轮融资。", eventDate: null, eventType: "融资", entities: ["甲公司"], status: "reported", sourceUrls: ["https://media.example/a"] },
    { headline: "乙公司完成B2轮融资", summary: "乙公司完成B2轮融资。", eventDate: null, eventType: "融资", entities: ["乙公司"], status: "reported", sourceUrls: ["https://media.example/b"] },
  ];
  const sameRoundEvidence = new Map([
    ["https://media.example/a", { evidenceStatus: "full" as const, evidencePublishedAt: "2024-02-23T08:00:00+08:00", content: "甲公司完成B2轮融资。" }],
    ["https://media.example/b", { evidenceStatus: "full" as const, evidencePublishedAt: "2024-03-01T08:00:00+08:00", content: "乙公司完成B2轮融资。" }],
  ]);
  const ambiguousReference = enforceAiNativeEvidenceBackedDates({
    answer: "甲公司完成B2轮融资，乙公司完成B2轮融资。该轮融资被媒体于2024年2月23日报道。",
    items: sameRoundItems, searchedAreas: [], unresolvedGaps: [], confidence: "medium",
  }, sameRoundEvidence);
  assert.doesNotMatch(ambiguousReference.answer, /该轮融资被媒体于2024年2月23日报道/, "多个同轮 active event 时，歧义代词不得从任一事件借用发布日期");
  const localSubjectReference = enforceAiNativeEvidenceBackedDates({
    answer: "甲公司完成B2轮融资，乙公司B2轮融资被媒体于2024年2月23日报道。",
    items: sameRoundItems, searchedAreas: [], unresolvedGaps: [], confidence: "medium",
  }, sameRoundEvidence);
  assert.doesNotMatch(localSubjectReference.answer, /乙公司B2轮融资被媒体于2024年2月23日报道/, "同句多事件时必须使用日期所在从句的唯一主体与来源 proof");
  const uniqueTrailingPublication = enforceAiNativeEvidenceBackedDates({
    answer: "甲公司完成B2轮融资，媒体于2024年2月23日报道。",
    items: [sameRoundItems[0]!], searchedAreas: [], unresolvedGaps: [], confidence: "medium",
  }, new Map([["https://media.example/a", sameRoundEvidence.get("https://media.example/a")!]]));
  assert.match(uniqueTrailingPublication.answer, /媒体于2024年2月23日报道/, "同句只有一个显式事件时，后置来源发布日期应继承该唯一 proof");
  const competingTrailingSubject = enforceAiNativeEvidenceBackedDates({
    answer: "甲公司完成B2轮融资，乙公司被媒体于2024年2月23日报道。",
    items: [sameRoundItems[0]!], searchedAreas: [], unresolvedGaps: [], confidence: "medium",
  }, new Map([["https://media.example/a", sameRoundEvidence.get("https://media.example/a")!]]));
  assert.doesNotMatch(competingTrailingSubject.answer, /乙公司被媒体于2024年2月23日报道/, "日期从句有竞争主体时不得继承整句唯一但不相关的 proof");

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
