import assert from "node:assert/strict";
import { buildAiNativeBriefResult, normalizeTaskInput } from "@/lib/intelligence";
import { runAiNativeResearch } from "@/lib/intelligenceAiNative";
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
  assert.doesNotMatch(JSON.stringify(result.telemetry), /must never enter telemetry|hidden/);

  const brief = buildAiNativeBriefResult(input, coverage, new Date("2026-08-09T12:00:00.000Z"), provider, result);
  assert.equal(brief.metadata.overview, directAnswer, "BriefResult must use report.answer without a second rewrite");
  assert.equal(brief.metadata.research?.mode, "ai-native");
  assert.notEqual(brief.metadata.overview, "本期未发现符合条件、且可核验的新增事实。");

  let repairTurn = 0;
  const repairedProvider: IntelligenceProvider = {
    ...provider,
    async runAgentTurn() {
      repairTurn++;
      if (repairTurn === 1) return toolCall("web_search", { queries: ["产业事项"] }, "search-repair");
      return { content: "not-json", reasoningContent: null, toolCalls: [] };
    },
    async generate() {
      return JSON.stringify({ answer: "修复后的完整研究回答。", items: [], searchedAreas: ["产业事项"], unresolvedGaps: [], confidence: "low" });
    },
  };
  const repaired = await runAiNativeResearch(input, coverage, { generationProvider: repairedProvider, retrieval: retrieval(), acquireEvidence: acquire });
  assert.equal(repaired.report.answer, "修复后的完整研究回答。");
  assert.equal(repaired.telemetry.finalization, "forced", "malformed final JSON gets exactly one forced finalization");

  const failedProvider: IntelligenceProvider = { ...repairedProvider, async generate() { throw new Error("repair failed"); } };
  await assert.rejects(
    runAiNativeResearch(input, coverage, { generationProvider: failedProvider, retrieval: retrieval(), acquireEvidence: acquire }),
    /AI_NATIVE_FINALIZATION_FAILED/,
    "failed repair must be an explicit execution failure",
  );

  console.log("intelligence AI-native tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
