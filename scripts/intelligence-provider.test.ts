import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRetrievalOverview, normalizeTaskInput } from "@/lib/intelligence";
import { resolveAIModelSelection } from "@/lib/ai";
import { mergeEventCandidates } from "@/lib/intelligenceBriefQuality";
import { isHistoricalReviewCandidate } from "@/lib/intelligenceTopicRelevance";
import { enforceClaimPublicationGate, type ResearchClaim } from "@/lib/intelligenceResearchAgent";
import { aggregateRetrievalResults, createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator, safeRetrievalMetadata, type IntelligenceProvider, type RetrievalProvider } from "@/lib/intelligenceProvider";
import { TavilyRetrievalProvider } from "@/lib/intelligenceTavilyAdapter";
import { BailianRetrievalProvider, bailianFreshness } from "@/lib/intelligenceBailianAdapter";
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

let controlledTransportAttempt = 0;
const controlledTavily = new TavilyRetrievalProvider({
  apiKey: "local-test-key",
  endpoint: "https://transport.invalid/search",
  fetchImpl: async () => {
    controlledTransportAttempt++;
    if (controlledTransportAttempt === 1) return new Response("upstream failed", { status: 503 });
    return new Response(JSON.stringify({ results: [{ title: "受控适配器融资事件", url: "https://controlled.example/event", content: "甲公司完成融资。", published_date: "2026-08-08" }] }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
const controlledFailed = await controlledTavily.searchWeb({ ...request, queries: ["第一次受控失败"] });
const controlledRetried = await controlledTavily.searchWeb({ ...request, queries: ["第二次受控成功"] });
assert.equal(controlledFailed.status, "failed", "真实 Tavily 适配层的受控 transport 失败必须保留失败状态");
assert.equal(controlledRetried.status, "success", "同一真实适配层可在显式重试时恢复，且不访问网络");
assert.equal(controlledRetried.results[0]?.publishedAt, "2026-08-08");
assert.equal(controlledTransportAttempt, 2);

let bailianTransportAttempts = 0;
const controlledBailian = new BailianRetrievalProvider({
  apiKey: "local-test-key",
  endpoint: "https://transport.invalid/dashscope",
  fetchImpl: async () => {
    bailianTransportAttempts++;
    return new Response(JSON.stringify({
      output: { choices: [{ finish_reason: "length", message: { content: [{ text: "被人为截断的搜索回答" }] } }] },
      usage: { input_tokens: 10, output_tokens: 4 },
      search_info: { search_results: [
        { title: "甲机器人公司完成B2轮融资", url: "https://official.example/2026-08-08/b2", snippet: "公司官网披露完成B2轮融资。", source: "公司官网", published_at: "2026-08-08" },
        { title: "甲机器人公司完成B+轮融资", url: "https://media.example/2026-08-08/b-plus", snippet: "媒体称公司完成B+轮融资，尚待官网确认。", source: "财经媒体", published_at: "2026-08-08" },
        { title: "机器人行业2023年融资盘点", url: "https://review.example/2023-12-31/roundup", snippet: "文章盘点2023年行业累计多家企业融资，不是本期新增。", source: "行业媒体", published_at: "2023-12-31" },
      ] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
const truncatedSearchAnswer = await controlledBailian.searchWeb({ ...request, queries: ["受控B2轮融资"] });
assert.equal(bailianTransportAttempts, 1, "受控检索不得因回答截断自动重试");
assert.equal(truncatedSearchAnswer.status, "success", "搜索回答被截断时，完整 search_results 仍应作为检索候选使用");
assert.equal(truncatedSearchAnswer.results.length, 3, "同池的官网事实、冲突报道和旧盘点均应交给质量层判别，适配器不应静默丢失");
const budgetBlockedBailian = new BailianRetrievalProvider({
  apiKey: "local-test-key",
  endpoint: "https://transport.invalid/dashscope",
  fetchImpl: async () => new Response(JSON.stringify({ error: "LIVE_GATEWAY_SEARCH_CALL_LIMIT" }), { status: 429, headers: { "content-type": "application/json" } }),
});
const budgetBlocked = await budgetBlockedBailian.searchWeb({ ...request, queries: ["受控预算耗尽"] });
assert.equal(budgetBlocked.status, "failed");
assert.equal(budgetBlocked.errorCode, "budget_exhausted", "本地成本闸门拒绝必须与供应商故障区分，且不得自动重试");
const repeatedProvider = aggregateRetrievalResults([
  { status: "success", providers: [{ provider: "bailian-web", attempted: true, succeeded: true, queryCount: 1, resultCount: 1 }], results: [item], fetchedAt: "2026-08-08T00:00:00.000Z" },
  { status: "failed", providers: [{ provider: "bailian-web", attempted: true, succeeded: false, queryCount: 1, resultCount: 0, errorCode: "budget_exhausted" }], results: [], fetchedAt: "2026-08-08T00:01:00.000Z" },
]);
assert.equal(repeatedProvider.status, "partial");
assert.equal(repeatedProvider.providers[0]?.status, "partial");
assert.equal(repeatedProvider.providers[0]?.succeeded, true);
assert.equal(repeatedProvider.providers[0]?.errorCode, undefined, "部分成功不能再携带一个看似整体失败的 errorCode");
assert.deepEqual(repeatedProvider.providers[0]?.errorCodes, ["budget_exhausted"]);
assert.equal(repeatedProvider.providers[0]?.attempts?.length, 2, "逐次成功与预算失败都必须保留供诊断");
const providerDeclaredPartial = aggregateRetrievalResults([{
  status: "partial",
  providers: [{ provider: "declared-partial", attempted: true, succeeded: true, status: "partial", partialFailure: true, queryCount: 2, resultCount: 1 }],
  results: [item],
}]);
assert.equal(providerDeclaredPartial.status, "partial", "provider 合法声明 partial 时不得因 succeeded=true 且无 errorCode 被升级为 success");
assert.equal(providerDeclaredPartial.providers[0]?.status, "partial");
const controlledPool = truncatedSearchAnswer.results;
const official = controlledPool.find((entry) => entry.url.includes("official.example"))!;
const conflict = controlledPool.find((entry) => entry.url.includes("media.example"))!;
const retrospective = controlledPool.find((entry) => entry.url.includes("review.example"))!;
const claimBase = { eventDate: "2026-08-08", backgroundDate: null, entities: ["甲机器人公司"], eventType: "融资", significance: "资本事项", relevanceToResearch: "high" as const, confidence: "high" as const };
const officialClaim: ResearchClaim = { ...claimBase, id: "official-claim", statement: "甲机器人公司完成B2轮融资", sourceUrls: [official.url], evidenceStatus: "full", classification: "fact", supportingEvidence: [{ url: official.url, relevantText: official.snippet, publishedAt: official.publishedAt }] };
const conflictClaim: ResearchClaim = { ...claimBase, id: "conflict-claim", statement: "甲机器人公司被报道完成B+轮融资", sourceUrls: [conflict.url], evidenceStatus: "unavailable", classification: "fact", supportingEvidence: [] };
assert.equal(enforceClaimPublicationGate(officialClaim).classification, "fact", "官网正文证据可保持事实");
assert.equal(enforceClaimPublicationGate(conflictClaim).classification, "clue", "缺少正文证据的冲突报道必须降为线索");
const separated = mergeEventCandidates([
  { id: "official", title: official.title, content: official.snippet, source: official.siteName, sourceUrl: official.url, publishedAt: official.publishedAt || "", subject: "甲机器人公司", region: null, kind: "fact", sourceTier: "S", origin: "web-search", evidenceStatus: "full" },
  { id: "conflict", title: conflict.title, content: conflict.snippet, source: conflict.siteName, sourceUrl: conflict.url, publishedAt: conflict.publishedAt || "", subject: "甲机器人公司", region: null, kind: "other", sourceTier: "C", origin: "web-search", evidenceStatus: "unavailable", isClue: true },
]);
assert.equal(separated.length, 2, "同事件的B2事实与B+冲突线索必须分离，不能被去重吞并");
assert.equal(isHistoricalReviewCandidate({ id: "review", title: retrospective.title, content: retrospective.snippet, source: retrospective.siteName, sourceUrl: retrospective.url, publishedAt: retrospective.publishedAt || "", subject: "甲机器人公司", region: null, kind: "other", sourceTier: "B", origin: "web-search" }, normalizeTaskInput({ name: "机器人企业资本动态", topics: ["机器人"], keywords: ["融资"] })), true, "旧融资盘点必须被识别为历史背景而非本期事实");

const historicalInput = normalizeTaskInput({
  name: "宇树科技2024年融资核验",
  topics: ["融资"],
  entities: ["宇树科技"],
  lookbackPeriod: { kind: "custom", start: "2024-01-01", end: "2024-12-31" },
  isActive: true,
});
assert.equal(bailianFreshness(historicalInput, new Date("2026-11-03T00:00:00.000Z").getTime()), null, "历史自定义区间不得被错误收窄为最近365天");
const recentCustomInput = normalizeTaskInput({
  name: "近一周融资核验",
  topics: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2026-10-27", end: "2026-11-03" },
  isActive: true,
});
assert.equal(bailianFreshness(recentCustomInput, new Date("2026-11-03T00:00:00.000Z").getTime()), 30, "刚结束的短窗口仍可使用相对 freshness");
const longCurrentInput = normalizeTaskInput({
  name: "跨年长窗口融资核验",
  topics: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2024-01-01", end: "2026-11-03" },
  isActive: true,
});
assert.equal(bailianFreshness(longCurrentInput, new Date("2026-11-03T00:00:00.000Z").getTime()), null, "截至当前的长跨度窗口也不得用365天 freshness 截断早年");
const boundaryInput = normalizeTaskInput({
  name: "365天边界核验",
  topics: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2025-11-03", end: "2026-11-03" },
  isActive: true,
});
assert.equal(bailianFreshness(boundaryInput, new Date("2026-11-03T00:00:00.000Z").getTime()), 365, "freshness 覆盖完整请求区间时可在边界使用");
const leapBoundaryInput = normalizeTaskInput({
  name: "闰年边界核验",
  topics: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2024-02-29", end: "2025-02-28" },
  isActive: true,
});
assert.equal(bailianFreshness(leapBoundaryInput, new Date("2025-02-28T00:00:00.000Z").getTime()), 365, "闰年日期不得因日历边界被错误截断");
let historicalPayload: Record<string, unknown> | null = null;
const historicalBailian = new BailianRetrievalProvider({
  apiKey: "local-test-key",
  endpoint: "https://transport.invalid/dashscope",
  fetchImpl: async (_url, init) => {
    historicalPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ search_info: { search_results: [] } }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
await historicalBailian.searchWeb({ input: historicalInput, start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z"), queries: ["宇树科技 2024 B2轮融资"] });
assert.ok(historicalPayload, "受控 transport 应捕获历史检索 payload");
const capturedHistoricalPayload = historicalPayload as unknown as Record<string, unknown>;
const historicalParameters = capturedHistoricalPayload.parameters as Record<string, unknown>;
const historicalSearchOptions = historicalParameters.search_options as Record<string, unknown>;
assert.equal("freshness" in historicalSearchOptions, false, "历史窗口的实际供应商请求不得携带相对当前时间的 freshness");
assert.match(JSON.stringify(capturedHistoricalPayload), /不要用当前最新资讯替代历史窗口/);

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
assert.match(buildRetrievalOverview(failed.status, [], input), /不能据此判断.*没有相关事件/, "全量检索失败不得伪装成无新闻");
assert.match(buildRetrievalOverview("partial", [], input), /不代表.*不存在相关事件/, "部分检索且空结果不能伪装成真实零结果");
assert.match(buildRetrievalOverview("success", [], input), /已成功完成的来源范围内/, "只有完整成功的空结果才能给出范围受限的零结果说明");

const metadata = JSON.stringify(safeRetrievalMetadata(partial, { searchCandidates: 1, relevancePassed: 1, relevanceDropped: 0, evidence: { full: 1, partial: 0, unavailable: 0 }, final: { facts: 1, clues: 0, trends: 0 } }));
assert.doesNotMatch(metadata, /secret|authorization|system prompt|api[_-]?key/i);
assert.match(metadata, /failed-a/);
assert.match(metadata, /fetchedAt/);
assert.match(metadata, /AI 公司完成融资/);

const core = readFileSync(join(root, "src/lib/intelligence.ts"), "utf8");
const kernel = readFileSync(join(root, "src/lib/intelligenceAiNative.ts"), "utf8");
const runtime = readFileSync(join(root, "src/lib/intelligenceAgentRuntime.ts"), "utf8");
const providerAdapter = readFileSync(join(root, "src/lib/intelligenceProvider.ts"), "utf8");
const conversationRoute = readFileSync(join(root, "src/app/api/conversations/[id]/chat/route.ts"), "utf8");
const evidence = readFileSync(join(root, "src/lib/intelligenceEvidence.ts"), "utf8");
const relevance = readFileSync(join(root, "src/lib/intelligenceTopicRelevance.ts"), "utf8");
assert.doesNotMatch(core, /BAILIAN_API_KEY|DashScope|searchWithDashScopeHTTP|qwen/);
assert.doesNotMatch(evidence, /BAILIAN_API_KEY|DashScope|qwen/);
assert.doesNotMatch(relevance, /BAILIAN_API_KEY|DashScope|qwen/);
assert.doesNotMatch(kernel, /deepseek-v4|gpt-|claude-|qwen-|provider\s*===/i, "AI-native kernel must remain model agnostic");
assert.doesNotMatch(runtime, /deepseek-v4|gpt-|claude-|qwen-|provider\s*===/i, "agent runtime must remain model agnostic");
assert.doesNotMatch(providerAdapter, /catch[\s\S]{0,200}(?:deepseek|qwen|openai)/i, "provider failure must not silently switch models");
assert.match(providerAdapter, /rejectTruncatedOutput:\s*true/, "情报最终生成必须显式启用截断拒发布");
assert.doesNotMatch(conversationRoute, /rejectTruncatedOutput/, "普通会话 SSE 不应继承情报专用的截断拒发布语义");
console.log("intelligence provider tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
