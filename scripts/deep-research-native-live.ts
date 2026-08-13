import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { createTavilyRetrievalProvider } from "@/lib/intelligenceTavilyAdapter";
import { normalizeTaskInput } from "@/lib/intelligence";
import { coverageForNative, runNativeDeepResearch } from "@/lib/deepResearchNative";

const bailianKey = process.env.BAILIAN_API_KEY;
const tavilyKey = process.env.TAVILY_API_KEY;
const outputPath = process.env.RESEARCH_LIVE_OUTPUT || "tmp/deep-research-cross-model-final.json";
const tasks = [
  { label: "资本动态-8月6至9日", name: "研究2026年8月6日至2026年8月9日中国AI大模型企业资本动态，重点检查重大融资信息。不得漂移到机器人、ETF、泛芯片或纯政策新闻。", topics: ["中国AI大模型企业"], keywords: ["融资", "资本动态", "投资"] , lookbackPeriod: { kind: "custom" as const, start: "2026-08-06T00:00:00.000Z", end: "2026-08-09T23:59:59.999Z" } },
  { label: "阿里云-通义千问", name: "研究最近14天阿里云和通义千问的重要公司动态，区分区间内事实、历史背景及日期未确认内容。", topics: ["阿里云", "通义千问"], keywords: ["融资", "资本", "产品", "经营"], lookbackPeriod: { kind: "days" as const, value: 14 } },
  { label: "AI芯片初创公司", name: "研究最近14天中国AI芯片初创公司的融资或重大经营进展。不得把上市公司半年报泛化为初创公司动态，不得把区间外事件写成区间内事实。资料不足可以得出限定检索范围内未发现可核实新增事件。", topics: ["中国AI芯片初创公司"], keywords: ["融资", "经营", "公告"], lookbackPeriod: { kind: "days" as const, value: 14 } },
];

type ModelSpec = { label: string; provider: "qwen" | "deepseek"; model: string; apiKey?: string; baseURL?: string; blocked?: string };
function modelSpecs(): ModelSpec[] {
  const specs: ModelSpec[] = [];
  if (bailianKey) specs.push({ label: "qwen-plus", provider: "qwen", model: "qwen-plus", apiKey: bailianKey, baseURL: process.env.RESEARCH_QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1" });
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) specs.push({ label: process.env.RESEARCH_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-configured", provider: "deepseek", model: process.env.RESEARCH_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat", apiKey: deepseekKey, baseURL: process.env.RESEARCH_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" });
  else specs.push({ label: "deepseek", provider: "deepseek", model: "not-run", blocked: "LIVE_VALIDATION_BLOCKED: independent DEEPSEEK_API_KEY not configured" });
  return specs;
}

function inputFor(task: typeof tasks[number]) {
  return normalizeTaskInput({ name: task.name, topics: task.topics, entities: [], keywords: task.keywords, regions: [], includeRequirements: [], excludeRequirements: [], maxItems: 10, lookbackPeriod: task.lookbackPeriod, outputInstructions: "面向投资人，直接输出自然语言 Markdown；区分事实、历史背景、日期未确认内容和分析。所有结论不得超出实际搜索和阅读材料。", executionMode: "manual", scheduleConfig: null, isActive: true });
}

async function runOne(spec: ModelSpec, task: typeof tasks[number]) {
  if (spec.blocked) return { model: spec.label, provider: spec.provider, task: task.label, error: spec.blocked };
  const provider = createIntelligenceGenerationProvider({ provider: spec.provider, apiKey: spec.apiKey || "", baseURL: spec.baseURL, model: spec.model });
  const retrieval = new IntelligenceRetrievalOrchestrator([], [createBailianRetrievalProvider({ apiKey: bailianKey }), createTavilyRetrievalProvider({ apiKey: tavilyKey })]);
  if (!provider.runAgentTurn) return { model: spec.label, provider: spec.provider, task: task.label, error: "LIVE_VALIDATION_BLOCKED: provider has no tool calling" };
  const input = inputFor(task);
  const started = Date.now();
  try {
    const result = await runNativeDeepResearch(input, { generationProvider: provider, retrieval, deadlineMs: 600_000 });
    const coverage = coverageForNative(input, new Date(started));
    const citationRefs = [...result.answer.matchAll(/\[S(\d+)\]/g)].map((match) => `S${match[1]}`);
    const citedSources = new Set(result.sourceList.map((source) => source.sourceRef));
    return { model: spec.label, provider: spec.provider, task: task.label, coverageStart: coverage.start.toISOString(), coverageEnd: coverage.end.toISOString(), elapsedMs: Date.now() - started, generationCalls: result.generationCalls, searchCalls: result.searchCalls, readUrls: result.readUrls, searchedQueries: result.searchedAreas, retrievalProviders: result.retrieval.providers, sources: result.sourceList, citationRefs, validCitationRefs: citationRefs.filter((ref) => citedSources.has(ref)), answer: result.answer };
  } catch (error) {
    return { model: spec.label, provider: spec.provider, task: task.label, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const records: unknown[] = [];
  for (const spec of modelSpecs()) for (const task of tasks) records.push(await runOne(spec, task));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, records: (records as Array<Record<string, unknown>>).map((record) => ({ ...record, answer: typeof record.answer === "string" ? `${record.answer.slice(0, 500)}…` : record.answer })) }));
}

void main();
