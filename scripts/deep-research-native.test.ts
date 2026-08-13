import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runNativeDeepResearch, coverageForNative } from "@/lib/deepResearchNative";
import type { IntelligenceProvider, RetrievalResult } from "@/lib/intelligenceProvider";
import type { IntelligenceTaskInput } from "@/lib/intelligence";

const input: IntelligenceTaskInput = {
  name: "研究 AI 行业近期融资与经营动态", topics: ["AI"], entities: [], keywords: ["融资"], regions: [],
  includeRequirements: [], excludeRequirements: [], maxItems: 10,
  lookbackPeriod: { kind: "days", value: 14 }, outputInstructions: "区分事实与判断，并说明不确定性。",
  executionMode: "manual", scheduleConfig: null, isActive: true,
};
const customInput = { ...input, lookbackPeriod: { kind: "custom" as const, start: "2026-07-01T00:00:00.000Z", end: "2026-07-15T00:00:00.000Z" } };
const url1 = "https://example.com/ai-round";
const url2 = "https://example.com/ai-operations";
const resultFor = (url: string, title: string, publishedAt: string) => ({ title, url, siteName: "公告来源", snippet: `${title}正文摘要`, publishedAt, sourceTier: "S" as const, domain: "example.com", query: "AI 近期" });

assert.equal(coverageForNative(input, new Date("2026-08-13T00:00:00.000Z")).start.toISOString(), "2026-07-30T00:00:00.000Z");
assert.deepEqual(coverageForNative(customInput), { start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-07-15T00:00:00.000Z") });

let calls = 0;
let retrievalStart: Date | undefined;
let evidenceCalls = 0;
let lastToolPayload = "";
let initialPrompt = "";
const provider: IntelligenceProvider = {
  id: "mock", model: "mock-model", capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true, toolCalling: true },
  async runAgentTurn({ messages }) {
    calls++;
    if (calls === 1) initialPrompt = String(messages[1]?.content ?? "");
    if (calls === 1) return { content: null, reasoningContent: null, toolCalls: [{ id: "s1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ queries: ["AI 融资 近期"] }) } }] };
    if (calls === 2) return { content: null, reasoningContent: null, toolCalls: [{ id: "r1", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: [url1] }) } }] };
    if (calls === 3) return { content: null, reasoningContent: null, toolCalls: [{ id: "r2", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: [url2] }) } }] };
    lastToolPayload = messages.filter((message) => message.role === "tool").map((message) => String(message.content)).join("\n");
    return { content: "## 研究结论\n甲公司近期完成融资，经营影响仍需后续观察。[S1]\n另一项说法没有来源。[S99]", reasoningContent: null, toolCalls: [] };
  },
};

async function main() {
  const intelligenceSource = readFileSync("src/lib/intelligence.ts", "utf8");
  const nativeBranch = intelligenceSource.slice(intelligenceSource.indexOf("runNativeDeepResearch"), intelligenceSource.indexOf("if (generationProvider.generate)", intelligenceSource.indexOf("runNativeDeepResearch")));
  assert.match(nativeBranch, /itemCount: 0/);
  assert.match(nativeBranch, /importantFacts: \[\]/);
  const subscriptionPage = readFileSync("src/components/data-apps/IntelligenceSubscriptions.tsx", "utf8");
  assert.match(subscriptionPage, /ReactMarkdown/);
  assert.doesNotMatch(subscriptionPage, /native-report/);
  const nativeSource = readFileSync("src/lib/deepResearchNative.ts", "utf8");
  assert.doesNotMatch(nativeSource, /integrated_review|forced finalization|JSON repair|candidate claims/i);

  const result = await runNativeDeepResearch(input, {
    generationProvider: provider,
    acquireEvidenceFn: async (candidates) => {
      evidenceCalls++;
      return { candidates: candidates.map((candidate) => ({ ...candidate, evidenceStatus: "full" as const, content: `${candidate.title}正文` })), stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 } };
    },
    retrieval: { async retrieve(request): Promise<RetrievalResult> {
      retrievalStart = request.start;
      return { status: "success", providers: [{ provider: "mock-search", attempted: true, succeeded: true, queryCount: 1, resultCount: 2 }], results: [resultFor(url1, "甲公司融资公告", "2026-08-10"), resultFor(url2, "甲公司经营公告", "2026-08-11")], fetchedAt: new Date().toISOString() };
    } },
  });

  assert.ok(retrievalStart && Date.now() - retrievalStart.getTime() > 13 * 86400000 && Date.now() - retrievalStart.getTime() < 15 * 86400000, "14-day search must not use a 365-day start");
  assert.match(initialPrompt, /当前日期：/);
  assert.match(initialPrompt, /绝对研究区间：/);
  assert.match(initialPrompt, /区间外资料只能作为历史背景/);
  assert.equal(calls, 4, "Agent should search, read twice, then produce one final answer");
  assert.match(lastToolPayload, /"sourceRef":"S1"/);
  assert.match(lastToolPayload, /"sourceRef":"S2"/);
  assert.match(result.answer, /\[S1\]\(https:\/\/example\.com\/ai-round\)/);
  assert.match(result.answer, /\[S99\]/);
  assert.match(result.answer, /引用提示/);
  assert.equal(result.sourceList.length, 1, "unknown sourceRef must not enter sourceList");
  assert.equal(result.sourceList[0]?.sourceRef, "S1");
  assert.equal(result.generationCalls, 4);
  assert.equal(result.searchCalls, 1);
  assert.equal(result.readUrls, 2);
  assert.equal(evidenceCalls, 2);
  assert.deepEqual(result.retrieval.evidence, { attempted: 2, full: 2, partial: 0, unavailable: 0 }, "evidence stats must accumulate across reads");

  let noCitationRetrieval = false;
  const noCitation = await runNativeDeepResearch({ ...input, lookbackPeriod: { kind: "days", value: 1 } }, {
    generationProvider: { ...provider, async runAgentTurn() { return { content: "没有可验证引用的报告", reasoningContent: null, toolCalls: [] }; } },
    retrieval: { async retrieve() { noCitationRetrieval = true; throw new Error("must not search"); } },
  });
  assert.equal(noCitationRetrieval, false);
  assert.equal(noCitation.sourceList.length, 0);
  assert.equal(noCitation.confidence, "low");
  assert.equal(noCitation.importantFacts[0]?.confidence, "low");

  const abortController = new AbortController();
  abortController.abort();
  let abortedProviderCalls = 0;
  await assert.rejects(() => runNativeDeepResearch(input, {
    generationProvider: { ...provider, async runAgentTurn() { abortedProviderCalls++; return { content: "不应执行", reasoningContent: null, toolCalls: [] }; } },
    retrieval: { async retrieve() { throw new Error("must not search after abort"); } }, signal: abortController.signal,
  }), /no usable result|aborted/i);
  assert.equal(abortedProviderCalls, 0, "abort must prevent model and subsequent tool calls");

  console.log("deep research native tests passed");
}

void main();
