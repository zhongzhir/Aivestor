/**
 * 模型 A/B research benchmark
 *
 * 在同一 Research Infrastructure 下，用固定任务集跑不同 Provider/Model，
 * 输出量化指标用于对比 recall / scope / 检索质量。
 *
 * 用法（需在 .env.local 配置 BENCH_API_KEY 或 SYSTEM_DEEPSEEK_API_KEY）：
 *   BENCH_PROVIDER=deepseek npm run research:benchmark
 *   BENCH_PROVIDER=qwen BENCH_MODEL=qwen-plus BENCH_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 npm run research:benchmark
 *
 * 注意：expectations 是启发式覆盖维度（keyword/实体是否出现在输出中），
 * 用于模型间的相对对比，不代表人工核验的绝对精度。
 */
import { coverageFor, normalizeTaskInput } from "@/lib/intelligence";
import { runAiNativeResearch, type AiNativeResearchResult } from "@/lib/intelligenceAiNative";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator, type IntelligenceProvider } from "@/lib/intelligenceProvider";
import type { AIProvider } from "@/lib/ai";

interface BenchmarkTask {
  key: string;
  label: string;
  input: Record<string, unknown>;
  expectations: string[];
}

const TASKS: BenchmarkTask[] = [
  {
    key: "llm-capital",
    label: "中国大模型企业资本动态",
    input: {
      name: "近10天中国大模型企业资本动态",
      topics: ["中国大模型企业", "资本动态"],
      keywords: ["融资", "上市", "发行股票", "并购", "估值"],
      regions: ["中国"],
      includeRequirements: ["收集近10天中国大模型企业的融资、上市、并购等资本动态", "从一级市场投资角度简要分析"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 10 },
      isActive: true,
    },
    expectations: ["融资", "上市"],
  },
  {
    key: "robot-funding",
    label: "机器人赛道融资与 IPO",
    input: {
      name: "最近一周机器人赛道融资与 IPO 动态",
      topics: ["机器人", "融资", "IPO"],
      keywords: ["人形机器人", "融资", "上市", "并购"],
      regions: ["中国"],
      includeRequirements: ["整理最近一周机器人赛道的重要融资和 IPO 动态", "同一事件合并", "10条以内"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 7 },
      isActive: true,
    },
    expectations: ["机器人", "融资"],
  },
  {
    key: "synbio-deals",
    label: "合成生物学投融资",
    input: {
      name: "最近两周合成生物学行业投融资事件",
      topics: ["合成生物学"],
      keywords: ["融资", "投资", "轮次", "生物制造"],
      regions: ["中国"],
      includeRequirements: ["整理最近两周合成生物学企业的投融资事件", "含金额与投资方", "10条以内"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 14 },
      isActive: true,
    },
    expectations: ["合成生物", "融资"],
  },
  {
    key: "low-altitude-policy",
    label: "低空经济政策与产业变化",
    input: {
      name: "最近两周低空经济政策与产业重要变化",
      topics: ["低空经济"],
      keywords: ["政策", "监管", "eVTOL", "无人机", "空域"],
      regions: ["中国"],
      includeRequirements: ["整理最近两周低空经济领域的政策与产业动态", "突出对项目判断的影响", "10条以内"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 14 },
      isActive: true,
    },
    expectations: ["低空", "政策"],
  },
  {
    key: "semiconductor-local",
    label: "半导体设备国产化进展",
    input: {
      name: "最近一个月半导体设备国产化重要进展",
      topics: ["半导体设备", "国产化"],
      keywords: ["国产替代", "设备", "光刻", "刻蚀", "薄膜"],
      regions: ["中国"],
      includeRequirements: ["整理最近一个月半导体设备国产化的重要进展", "区分重要事实与趋势", "10条以内"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 30 },
      isActive: true,
    },
    expectations: ["半导体", "国产化"],
  },
  {
    key: "innovative-drug-bd",
    label: "创新药海外 BD 交易",
    input: {
      name: "最近两周中国创新药海外 BD 交易",
      topics: ["创新药", "海外授权", "BD"],
      keywords: ["license out", "BD", "首付款", "对外授权"],
      regions: ["中国"],
      includeRequirements: ["整理最近两周中国创新药企业的海外授权/BD交易", "含交易金额与合作伙伴", "10条以内"],
      maxItems: 10,
      lookbackPeriod: { kind: "days", value: 14 },
      isActive: true,
    },
    expectations: ["BD", "授权"],
  },
];

function buildCredentials() {
  const provider = process.env.BENCH_PROVIDER || "deepseek";
  const apiKey = process.env.BENCH_API_KEY || process.env.SYSTEM_DEEPSEEK_API_KEY || process.env.BAILIAN_API_KEY;
  if (!apiKey) throw new Error("Missing BENCH_API_KEY / SYSTEM_DEEPSEEK_API_KEY / BAILIAN_API_KEY");
  return {
    provider: provider as AIProvider,
    apiKey,
    ...(process.env.BENCH_MODEL ? { model: process.env.BENCH_MODEL } : {}),
    ...(process.env.BENCH_BASE_URL ? { baseURL: process.env.BENCH_BASE_URL } : {}),
  } as const;
}

function expectationRecall(result: AiNativeResearchResult, expectations: string[]): { matched: string[]; missing: string[]; recall: number } {
  const haystack = [
    result.report.answer,
    ...result.report.items.flatMap((item) => [item.headline, item.summary, item.assessment ?? "", item.entities.join(" ")]),
  ].join(" ").toLocaleLowerCase();
  const matched = expectations.filter((term) => haystack.includes(term.toLocaleLowerCase()));
  const missing = expectations.filter((term) => !haystack.includes(term.toLocaleLowerCase()));
  return { matched, missing, recall: expectations.length ? matched.length / expectations.length : 1 };
}

async function runTask(task: BenchmarkTask, now: Date, provider: IntelligenceProvider) {
  const started = Date.now();
  const input = normalizeTaskInput(task.input);
  const coverage = coverageFor(input, now);
  const retrieval = new IntelligenceRetrievalOrchestrator([provider]);
  try {
    const result = await runAiNativeResearch(input, coverage, { generationProvider: provider, retrieval });
    const recall = expectationRecall(result, task.expectations);
    return {
      key: task.key,
      label: task.label,
      ok: true,
      durationMs: Date.now() - started,
      recall,
      itemCount: result.report.items.length,
      statusSplit: {
        confirmed: result.report.items.filter((item) => item.status === "confirmed").length,
        reported: result.report.items.filter((item) => item.status === "reported").length,
        context: result.report.items.filter((item) => item.status === "context").length,
      },
      unresolvedGaps: result.report.unresolvedGaps,
      confidence: result.report.confidence,
      searchCalls: result.telemetry.searchCalls,
      totalQueries: result.telemetry.totalQueries,
      readUrls: result.telemetry.readUrls,
      sourceCount: result.telemetry.sourceCount,
      retrieval: {
        status: result.retrieval.status,
        providers: result.retrieval.providers.map((entry) => `${entry.provider}:${entry.succeeded ? `ok(${entry.resultCount})` : entry.errorCode ?? "fail"}`),
        evidence: result.retrieval.evidence,
      },
    };
  } catch (error) {
    return { key: task.key, label: task.label, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
  }
}

async function main() {
  const provider = createIntelligenceGenerationProvider(buildCredentials());
  const now = new Date();
  const results: Array<Awaited<ReturnType<typeof runTask>>> = [];
  for (const task of TASKS) {
    results.push(await runTask(task, now, provider));
  }
  const isOk = (result: typeof results[number]): result is typeof results[number] & { ok: true; itemCount: number; durationMs: number } => result.ok === true;
  const okResults = results.filter(isOk);
  const scored = okResults.filter((result): result is typeof result & { recall: { recall: number } } => "recall" in result);
  const avgRecall = scored.length ? scored.reduce((sum, result) => sum + result.recall.recall, 0) / scored.length : null;
  console.log(JSON.stringify({
    provider: provider.id,
    model: provider.model || null,
    runAt: now.toISOString(),
    summary: {
      ok: okResults.length,
      failed: results.length - okResults.length,
      avgRecall,
      totalItems: okResults.reduce((sum, result) => sum + result.itemCount, 0),
      totalDurationMs: okResults.reduce((sum, result) => sum + result.durationMs, 0),
    },
    tasks: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
