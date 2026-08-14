import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRetrievalOverview, normalizeTaskInput } from "@/lib/intelligence";
import { resolveAIModelSelection } from "@/lib/ai";
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
assert.equal(deepseek.capabilities.agenticToolUse, true, "首个真实 Agent adapter 应暴露原生多轮工具能力");
assert.equal(deepseek.capabilities.toolCalling, true);
assert.equal(deepseek.capabilities.structuredOutput, true);
assert.equal(typeof deepseek.runAgentTurn, "function");
assert.equal(deepseek.model, "deepseek-v4-flash", "平台适配器默认必须使用 V4-Flash");

const configured = resolveAIModelSelection({ credentialProvider: "deepseek", useSystemConfiguration: true, env: { SYSTEM_AI_PROVIDER: "deepseek", SYSTEM_AI_MODEL: "configured-flash" } });
assert.deepEqual(configured, { provider: "deepseek", model: "configured-flash", source: "system" }, "SYSTEM_AI_MODEL 应覆盖适配器默认模型");
const byok = resolveAIModelSelection({ credentialProvider: "openai", credentialModel: "user-owned-model", useSystemConfiguration: false, env: { SYSTEM_AI_PROVIDER: "deepseek", SYSTEM_AI_MODEL: "platform-model" } });
assert.deepEqual(byok, { provider: "openai", model: "user-owned-model", source: "credentials" }, "用户 BYOK 模型必须优先于系统配置");
const explicit = resolveAIModelSelection({ selectedProvider: "qwen", selectedModel: "user-selected-model", credentialProvider: "deepseek", credentialModel: "credential-model", useSystemConfiguration: true, env: { SYSTEM_AI_MODEL: "platform-model" } });
assert.deepEqual(explicit, { provider: "qwen", model: "user-selected-model", source: "explicit" }, "用户明确选择必须拥有最高优先级");
const deepseekOrchestrator = new IntelligenceRetrievalOrchestrator([{ ...deepseek, searchWeb: undefined }], [provider("independent-web", { status: "success", results: [item], queryCount: 1 })]);
assert.equal((await deepseekOrchestrator.retrieve(request)).results.length, 1, "DeepSeek 应自动使用独立检索");

const qwen = createIntelligenceGenerationProvider({ provider: "qwen", apiKey: "secret", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
assert.equal(qwen.capabilities.nativeWebSearch, false, "检索必须由独立工具提供，不能依赖 Qwen 原生搜索");
assert.equal(qwen.capabilities.agenticToolUse, true, "Qwen 已通过真实多轮协议验收");
assert.equal(qwen.capabilities.toolCalling, true);
assert.equal(typeof qwen.runAgentTurn, "function", "Qwen adapter 应暴露通用 runAgentTurn");
const qwenRetrieval = new IntelligenceRetrievalOrchestrator([{ ...qwen, searchWeb: undefined }], [provider("independent-web", { status: "success", results: [item], queryCount: 1 })]);
assert.equal((await qwenRetrieval.retrieve(request)).providers[0]?.provider, "independent-web", "Qwen 与 DeepSeek 必须走同一检索工具契约");

for (const provider of ["openai", "claude", "ctyun", "zhipu", "moonshot"] as const) {
  const unverified = createIntelligenceGenerationProvider({ provider, apiKey: "secret" });
  assert.equal(unverified.capabilities.agenticToolUse, false, `${provider} 未经真实协议验收不得打开 agenticToolUse`);
  assert.notEqual(typeof unverified.runAgentTurn, "function", `${provider} 不应暴露 runAgentTurn`);
}

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
assert.deepEqual(partial.providers.map((entry) => entry.provider), ["failed-a", "success-b"], "主检索失败时必须顺序切换备用检索，而不是伪装成功");

const secondItem: WebSearchItem = { ...item, title: "AI 公司发布交易公告", url: "https://second.example/announcement", domain: "second.example" };
const multiSource = await new IntelligenceRetrievalOrchestrator([], [
  provider("web-a", { status: "success", results: [item], queryCount: 1 }),
  provider("web-b", { status: "success", results: [secondItem], queryCount: 1 }),
]).retrieve(request);
assert.equal(multiSource.status, "success");
assert.deepEqual(multiSource.providers.map((entry) => entry.provider), ["web-a", "web-b"], "独立搜索供应商必须并行参与以提升召回");
assert.deepEqual(multiSource.results.map((entry) => entry.url).sort(), [item.url, secondItem.url].sort(), "并行搜索应合并双方来源");
assert.deepEqual(multiSource.results.find((entry) => entry.url === item.url)?.searchProviders, ["web-a"]);

const failed = await new IntelligenceRetrievalOrchestrator([], [provider("failed-a", { status: "failed", results: [], queryCount: 1, errorCode: "timeout" })]).retrieve(request);
assert.equal(failed.status, "failed");
assert.equal(buildRetrievalOverview(failed.status, [], input), "本期联网检索未成功完成，请稍后重新生成。", "全量检索失败不得伪装成无新闻");
assert.notEqual(buildRetrievalOverview("success", [], input), "本期联网检索未成功完成，请稍后重新生成。");

const metadata = JSON.stringify(safeRetrievalMetadata(partial, { searchCandidates: 1, relevancePassed: 1, relevanceDropped: 0, evidence: { full: 1, partial: 0, unavailable: 0 }, final: { facts: 1, clues: 0, trends: 0 } }));
assert.doesNotMatch(metadata, /secret|authorization|system prompt|api[_-]?key/i);
assert.match(metadata, /failed-a/);
assert.match(metadata, /fetchedAt/);
assert.match(metadata, /AI 公司完成融资/);

const core = readFileSync(join(root, "src/lib/intelligence.ts"), "utf8");
const kernel = readFileSync(join(root, "src/lib/intelligenceAiNative.ts"), "utf8");
const runtime = readFileSync(join(root, "src/lib/intelligenceAgentRuntime.ts"), "utf8");
const providerAdapter = readFileSync(join(root, "src/lib/intelligenceProvider.ts"), "utf8");
const evidence = readFileSync(join(root, "src/lib/intelligenceEvidence.ts"), "utf8");
const relevance = readFileSync(join(root, "src/lib/intelligenceTopicRelevance.ts"), "utf8");
assert.doesNotMatch(core, /BAILIAN_API_KEY|DashScope|searchWithDashScopeHTTP|qwen/);
assert.doesNotMatch(evidence, /BAILIAN_API_KEY|DashScope|qwen/);
assert.doesNotMatch(relevance, /BAILIAN_API_KEY|DashScope|qwen/);
assert.doesNotMatch(kernel, /deepseek-v4|gpt-|claude-|qwen-|provider\s*===/i, "AI-native kernel must remain model agnostic");
assert.doesNotMatch(runtime, /deepseek-v4|gpt-|claude-|qwen-|provider\s*===/i, "agent runtime must remain model agnostic");
assert.doesNotMatch(providerAdapter, /catch[\s\S]{0,200}(?:deepseek|qwen|openai)/i, "provider failure must not silently switch models");
console.log("intelligence provider tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
