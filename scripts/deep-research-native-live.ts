import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { normalizeTaskInput } from "@/lib/intelligence";
import { coverageForNative, runNativeDeepResearch } from "@/lib/deepResearchNative";

const bailianKey = process.env.BAILIAN_API_KEY;
const scarceTask = { label: "资料稀缺任务", name: "研究中国 AI 芯片初创公司在最近两周是否出现公开融资或重大经营进展。公开资料可能稀缺，请明确说明没有证据的部分，不要把旧闻当作近期事实，并给出投资人下一步核查建议。", topics: ["中国 AI 芯片初创公司"], keywords: ["融资", "经营", "公告"] };
const tasks = [
  { label: "行业近期动态", name: "研究中国 AI 基础设施行业最近两周的重要动态，区分已确认事实、趋势和不确定性，并简要说明对早期投资人的意义。", topics: ["中国 AI 基础设施", "大模型"], keywords: ["融资", "产品", "合作"] },
  { label: "指定公司经营动态", name: "研究阿里云和通义千问最近两周的资本、产品与经营动态，区分公司公告与媒体报道，并简要分析其对 AI 投资机会的意义。", topics: ["阿里云", "通义千问"], keywords: ["融资", "资本", "产品", "经营"] },
  scarceTask,
];

type ModelSpec = { label: string; provider: "qwen" | "deepseek"; model: string; apiKey?: string; baseURL?: string };
function modelSpecs(): ModelSpec[] {
  const specs: ModelSpec[] = [];
  if (bailianKey) {
    specs.push({ label: "qwen-plus", provider: "qwen", model: process.env.RESEARCH_QWEN_PLUS_MODEL || "qwen-plus", apiKey: bailianKey, baseURL: process.env.RESEARCH_QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1" });
    specs.push({ label: "qwen-max", provider: "qwen", model: process.env.RESEARCH_QWEN_MAX_MODEL || "qwen-max", apiKey: bailianKey, baseURL: process.env.RESEARCH_QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1" });
  }
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) specs.push({ label: "deepseek", provider: "deepseek", model: process.env.RESEARCH_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat", apiKey: deepseekKey, baseURL: process.env.RESEARCH_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" });
  return specs;
}

function inputFor(task: typeof tasks[number]) {
  return normalizeTaskInput({ name: task.name, topics: task.topics, entities: [], keywords: task.keywords, regions: [], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: { kind: "days", value: 14 }, outputInstructions: "面向投资人，直接输出自然语言 Markdown；事实、分析和不确定性清楚分开。", executionMode: "manual", scheduleConfig: null, isActive: true });
}

async function runOne(spec: ModelSpec, task: typeof tasks[number]) {
  const provider = createIntelligenceGenerationProvider({ provider: spec.provider, apiKey: spec.apiKey || "", baseURL: spec.baseURL, model: spec.model });
  const retrieval = new IntelligenceRetrievalOrchestrator([], [createBailianRetrievalProvider()]);
  if (!provider.runAgentTurn) throw new Error(`LIVE_VALIDATION_BLOCKED: ${spec.label} has no tool calling`);
  const input = inputFor(task);
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
  return {
    model: spec.label, provider: spec.provider, task: task.label, coverageStart: coverage.start.toISOString(), coverageEnd: coverage.end.toISOString(),
    elapsedMs: Date.now() - started, generationCalls: result.generationCalls, searchCalls: result.searchCalls, readUrls: result.readUrls,
    sourceCount: result.sourceList.length, firstPartySourceCount: result.sourceList.filter((source) => source.sourceTier === "S").length,
    sources: result.sourceList.map((source) => ({ sourceRef: source.sourceRef, title: source.title, source: source.source, url: source.url, sourceTier: source.sourceTier, publishedAt: source.publishedAt })),
    citationRefs, validCitationRefs: citationRefs.filter((ref) => citedSources.has(ref)), outOfRangeSources,
    historicalBackgroundMentioned: /历史背景|早于研究区间|事件发生时间未确认/.test(result.answer),
    reportExcerptForManualReview: result.answer.replace(/\s+/g, " ").slice(0, 1600),
    answerLength: result.answer.length, retrieval: result.retrieval.status,
  };
}

async function main() {
  const specs = modelSpecs();
  if (!specs.length) throw new Error("LIVE_VALIDATION_BLOCKED: no configured Qwen or DeepSeek credentials");
  const selected = process.env.RESEARCH_LIVE_MODE === "scarce" ? [scarceTask] : tasks;
  const selectedSpecs = process.env.RESEARCH_LIVE_MODE === "scarce" ? specs : [specs.find((spec) => spec.label === (process.env.RESEARCH_CANDIDATE_MODEL || "qwen-max")) || specs[0]];
  for (const spec of selectedSpecs) for (const task of selected) {
    try { console.log(JSON.stringify(await runOne(spec, task))); }
    catch (error) { console.log(JSON.stringify({ model: spec.label, provider: spec.provider, task: task.label, error: error instanceof Error ? error.message : String(error) })); }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
