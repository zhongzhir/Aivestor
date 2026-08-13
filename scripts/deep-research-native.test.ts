import assert from "node:assert/strict";
import { runNativeDeepResearch } from "@/lib/deepResearchNative";
import type { IntelligenceProvider } from "@/lib/intelligenceProvider";
import type { IntelligenceTaskInput } from "@/lib/intelligence";

const input: IntelligenceTaskInput = {
  name: "研究 AI 行业近期融资与经营动态",
  topics: ["AI"], entities: [], keywords: ["融资"], regions: [],
  includeRequirements: [], excludeRequirements: [], maxItems: 10,
  lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "区分事实与判断，并说明不确定性。",
  executionMode: "manual", scheduleConfig: null, isActive: true,
};

const url = "https://example.com/ai-round";
let calls = 0;
const provider: IntelligenceProvider = {
  id: "mock", model: "mock-model", capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true, toolCalling: true },
  async runAgentTurn({ messages }) {
    calls++;
    if (calls === 1) return { content: null, reasoningContent: null, toolCalls: [{ id: "s1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ queries: ["AI 融资 近期"] }) } }] };
    if (calls === 2) return { content: null, reasoningContent: null, toolCalls: [{ id: "r1", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: [url] }) } }] };
    assert.ok(messages.some((message) => message.role === "tool" && message.content.includes(url)));
    return { content: "## 研究结论\n甲公司近期完成融资，经营影响仍需后续观察。[1]\n\n另一个说法没有来源。[99]", reasoningContent: null, toolCalls: [] };
  },
};

async function main() {
const result = await runNativeDeepResearch(input, {
  generationProvider: provider,
  acquireEvidenceFn: async (candidates) => ({ candidates: candidates.map((candidate) => ({ ...candidate, evidenceStatus: "full" as const, content: "甲公司公告确认完成融资。" })), stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 } }),
  retrieval: { async retrieve() { return { status: "success", providers: [{ provider: "mock-search", attempted: true, succeeded: true, queryCount: 1, resultCount: 1 }], results: [{ title: "甲公司融资公告", url, siteName: "公告来源", snippet: "甲公司完成融资，后续经营影响仍需观察。", publishedAt: "2026-08-10", sourceTier: "S", domain: "example.com", query: "AI 融资 近期" }], fetchedAt: new Date().toISOString() }; } },
});

assert.equal(calls, 3, "Agent should autonomously search, read, then produce one final answer");
assert.match(result.answer, /甲公司近期完成融资/);
assert.match(result.answer, /\[1\]\(https:\/\/example\.com\/ai-round\)/);
assert.match(result.answer, /引用提示/);
assert.equal(result.sourceList.length, 1);
assert.equal(result.generationCalls, 3);
assert.equal(result.searchCalls, 1);
assert.equal(result.readUrls, 1);

const abortController = new AbortController();
abortController.abort();
await assert.rejects(() => runNativeDeepResearch(input, { generationProvider: provider, retrieval: { async retrieve() { throw new Error("must not search after abort"); } }, signal: abortController.signal }), /no usable result|aborted/i);

console.log("deep research native tests passed");
}

void main();
