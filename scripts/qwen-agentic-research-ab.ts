import { coverageFor, normalizeTaskInput } from "@/lib/intelligence";
import { runAiNativeResearch } from "@/lib/intelligenceAiNative";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";

const apiKey = process.env.SYSTEM_AI_API_KEY || process.env.BAILIAN_API_KEY;
if (!apiKey) throw new Error("Missing SYSTEM_AI_API_KEY (or BAILIAN_API_KEY) for Qwen Intelligence A/B");

const now = new Date();
const input = normalizeTaskInput({
  name: "近10天中国大模型企业资本动态",
  topics: ["中国大模型企业", "资本动态"],
  entities: ["中国企业"],
  keywords: ["融资", "上市", "发行股票", "发行债券", "资本动态"],
  includeRequirements: ["收集近10天中国大模型企业的融资、上市、发行股票债券等资本动态", "10条以内", "从一级市场投资角度简要分析"],
  maxItems: 10,
  lookbackPeriod: { kind: "days", value: 10 },
  outputInstructions: "收集近10天中国大模型企业的融资、上市、发行股票债券等资本动态，10条以内，并从一级市场投资角度简要分析。",
  isActive: true,
});
const coverage = coverageFor(input, now);
const generationProvider = createIntelligenceGenerationProvider({
  provider: "qwen",
  apiKey,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-plus",
});
const retrieval = new IntelligenceRetrievalOrchestrator([generationProvider]);

async function main() {
  const started = Date.now();
  const result = await runAiNativeResearch(input, coverage, { generationProvider, retrieval });
  console.log(JSON.stringify({
    provider: "qwen",
    model: "qwen-plus",
    finalization: result.telemetry.finalization,
    searchCalls: result.telemetry.searchCalls,
    totalQueries: result.telemetry.totalQueries,
    readUrls: result.telemetry.readUrls,
    sourceCount: result.telemetry.sourceCount,
    reportItemCount: result.telemetry.reportItemCount,
    searchedAreas: result.report.searchedAreas,
    unresolvedGaps: result.report.unresolvedGaps,
    finalAnswer: result.report.answer,
    items: result.report.items,
    duration: `${Date.now() - started}ms`,
    telemetry: result.telemetry,
    retrieval: result.retrieval,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "QWEN_AGENTIC_RESEARCH_FAILED", provider: "qwen", model: "qwen-plus", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
