import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRetrievalOverview, normalizeTaskInput } from "@/lib/intelligence";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator, safeRetrievalMetadata, type IntelligenceProvider, type RetrievalProvider } from "@/lib/intelligenceProvider";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";

const root = process.cwd();
const item: WebSearchItem = { title: "AI 公司完成融资", url: "https://example.com/event", siteName: "Example", snippet: "公司完成一轮融资。", publishedAt: "2026-08-08T00:00:00.000Z", sourceTier: "A", domain: "example.com", query: "AI 融资" };
const input = normalizeTaskInput({ name: "AI 资本动态", topics: ["AI"], lookbackPeriod: { kind: "days", value: 3 }, isActive: true });
const request = { input, start: new Date("2026-08-05T00:00:00.000Z") };

function provider(id: string, result: { status: "success" | "partial" | "failed"; results: WebSearchItem[]; queryCount: number; errorCode?: string }): RetrievalProvider {
  return { id, searchWeb: async () => result };
}

async function main() {
const deepseek = createIntelligenceGenerationProvider({ provider: "deepseek", apiKey: "secret" });
assert.equal(deepseek.capabilities.generation, true);
assert.equal(deepseek.capabilities.nativeWebSearch, false);
const deepseekOrchestrator = new IntelligenceRetrievalOrchestrator([{ ...deepseek, searchWeb: undefined }], [provider("independent-web", { status: "success", results: [item], queryCount: 1 })]);
assert.equal((await deepseekOrchestrator.retrieve(request)).results.length, 1, "DeepSeek 应自动使用独立检索");

const qwen = createIntelligenceGenerationProvider({ provider: "qwen", apiKey: "secret", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
assert.equal(qwen.capabilities.nativeWebSearch, true, "Qwen DashScope 适配器应暴露原生检索能力");
const qwenFallback = new IntelligenceRetrievalOrchestrator([{ ...qwen, searchWeb: async () => ({ status: "success", results: [item], queryCount: 1 }) }]);
assert.equal((await qwenFallback.retrieve(request)).providers[0]?.provider, "qwen");

const native: IntelligenceProvider = { id: "native-test", capabilities: { generation: true, nativeWebSearch: true }, searchWeb: async () => ({ status: "success", results: [item], queryCount: 1 }) };
assert.equal((await new IntelligenceRetrievalOrchestrator([native], [provider("must-not-run", { status: "failed", results: [], queryCount: 1 })]).retrieve(request)).providers[0]?.provider, "native-test");

const nativeFailure = await new IntelligenceRetrievalOrchestrator(
  [{ id: "native-failure", capabilities: { generation: true, nativeWebSearch: true }, searchWeb: async () => ({ status: "failed", results: [], queryCount: 1, errorCode: "upstream_error" }) }],
  [provider("independent-fallback", { status: "success", results: [item], queryCount: 1 })],
).retrieve(request);
assert.equal(nativeFailure.status, "partial", "native 失败且独立检索成功时整体应为 partial");
assert.deepEqual(nativeFailure.providers.map((entry) => entry.provider), ["native-failure", "independent-fallback"]);

const partial = await new IntelligenceRetrievalOrchestrator([], [provider("failed-a", { status: "failed", results: [], queryCount: 1, errorCode: "timeout" }), provider("success-b", { status: "success", results: [item], queryCount: 1 })]).retrieve(request);
assert.equal(partial.status, "partial");
assert.equal(partial.results.length, 1);

const failed = await new IntelligenceRetrievalOrchestrator([], [provider("failed-a", { status: "failed", results: [], queryCount: 1, errorCode: "timeout" })]).retrieve(request);
assert.equal(failed.status, "failed");
assert.equal(buildRetrievalOverview(failed.status, [], input), "本期联网检索未成功完成，请稍后重新生成。", "全量检索失败不得伪装成无新闻");
assert.notEqual(buildRetrievalOverview("success", [], input), "本期联网检索未成功完成，请稍后重新生成。");

const metadata = JSON.stringify(safeRetrievalMetadata(partial, { searchCandidates: 1, relevancePassed: 1, relevanceDropped: 0, evidence: { full: 1, partial: 0, unavailable: 0 }, final: { facts: 1, clues: 0, trends: 0 } }));
assert.doesNotMatch(metadata, /secret|authorization|system prompt|api[_-]?key/i);
assert.match(metadata, /failed-a/);

const core = readFileSync(join(root, "src/lib/intelligence.ts"), "utf8");
const evidence = readFileSync(join(root, "src/lib/intelligenceEvidence.ts"), "utf8");
const relevance = readFileSync(join(root, "src/lib/intelligenceTopicRelevance.ts"), "utf8");
assert.doesNotMatch(core, /BAILIAN_API_KEY|DashScope|searchWithDashScopeHTTP|qwen/);
assert.doesNotMatch(evidence, /BAILIAN_API_KEY|DashScope|qwen/);
assert.doesNotMatch(relevance, /BAILIAN_API_KEY|DashScope|qwen/);
console.log("intelligence provider tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
