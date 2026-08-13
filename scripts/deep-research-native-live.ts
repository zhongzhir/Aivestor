import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { normalizeTaskInput } from "@/lib/intelligence";
import { coverageForNative, runNativeDeepResearch } from "@/lib/deepResearchNative";

const apiKey = process.env.BAILIAN_API_KEY;
const provider = createIntelligenceGenerationProvider({ provider: "qwen", apiKey: apiKey || "", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: process.env.RESEARCH_QWEN_MODEL || "qwen-plus" });
const retrieval = new IntelligenceRetrievalOrchestrator([], [createBailianRetrievalProvider()]);
const tasks = [
  { label: "行业近期动态", name: "研究中国 AI 基础设施行业最近两周的重要动态，区分已确认事实、趋势和不确定性，并简要说明对早期投资人的意义。", topics: ["中国 AI 基础设施", "大模型"], keywords: ["融资", "产品", "合作"] },
  { label: "指定公司经营动态", name: "研究阿里云和通义千问最近两周的资本、产品与经营动态，区分公司公告与媒体报道，并简要分析其对 AI 投资机会的意义。", topics: ["阿里云", "通义千问"], keywords: ["融资", "资本", "产品", "经营"] },
  { label: "资料稀缺任务", name: "研究中国 AI 芯片初创公司在最近两周是否出现公开融资或重大经营进展。公开资料可能稀缺，请明确说明没有证据的部分，不要把旧闻当作近期事实，并给出投资人下一步核查建议。", topics: ["中国 AI 芯片初创公司"], keywords: ["融资", "经营", "公告"] },
];

async function main() {
  if (!process.env.BAILIAN_API_KEY) throw new Error("LIVE_VALIDATION_BLOCKED: BAILIAN_API_KEY missing");
  if (!provider.runAgentTurn) throw new Error("LIVE_VALIDATION_BLOCKED: selected Qwen adapter has no tool calling");
  for (const task of tasks) {
    const input = normalizeTaskInput({ name: task.name, topics: task.topics, entities: [], keywords: task.keywords, regions: [], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 14 }, outputInstructions: "面向投资人，直接输出自然语言 Markdown；事实、分析和不确定性清楚分开。", executionMode: "manual", scheduleConfig: null, isActive: true });
    const started = Date.now();
    const result = await runNativeDeepResearch(input, { generationProvider: provider, retrieval, deadlineMs: 600_000 });
    const coverage = coverageForNative(input, new Date(started));
    const citationRefs = [...result.answer.matchAll(/\[S(\d+)\]/g)].map((match) => `S${match[1]}`);
    const citedSources = new Set(result.sourceList.map((source) => source.sourceRef));
    const outOfRangeSources = result.sourceList.filter((source) => {
      if (!source.publishedAt) return false;
      const published = new Date(source.publishedAt).getTime();
      return Number.isFinite(published) && (published < coverage.start.getTime() || published > coverage.end.getTime());
    }).map((source) => ({ sourceRef: source.sourceRef, publishedAt: source.publishedAt }));
    console.log(JSON.stringify({ label: task.label, model: provider.model, coverageStart: coverage.start.toISOString(), coverageEnd: coverage.end.toISOString(), elapsedMs: Date.now() - started, generationCalls: result.generationCalls, searchCalls: result.searchCalls, readUrls: result.readUrls, sourceCount: result.sourceList.length, firstPartySourceCount: result.sourceList.filter((source) => source.sourceTier === "S").length, citationRefs, validCitationRefs: citationRefs.filter((ref) => citedSources.has(ref)), outOfRangeSources, retrieval: result.retrieval.status, answerLength: result.answer.length, answerPreview: result.answer.replace(/\s+/g, " ").slice(0, 280), sources: result.sourceList.slice(0, 5).map((source) => ({ sourceRef: source.sourceRef, source: source.source, sourceTier: source.sourceTier, publishedAt: source.publishedAt, url: source.url })) }));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
