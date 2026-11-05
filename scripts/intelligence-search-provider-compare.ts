/**
 * Explicitly approved live comparison only. It never runs from the normal test
 * suite or scheduler and prints no credentials. Both providers receive the same
 * public task, queries and historical window.
 */
import { normalizeTaskInput } from "@/lib/intelligence";
import { createBailianRetrievalProvider } from "@/lib/intelligenceBailianAdapter";
import { DeepSeekSearchFetchBudget, createDeepSeekSearchFetchAdapter } from "@/lib/intelligenceDeepSeekAdapter";
import { fetchPublicEvidence, type EvidenceResult } from "@/lib/intelligenceEvidence";
import { getGenerationAccess } from "@/lib/intelligenceGeneration";
import type { RetrievalRunResult } from "@/lib/intelligenceProvider";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PersistentDeepSeekComparisonLedger } from "./intelligence-compare-usd-ledger";
import {
  LIVE_BUDGET_LIMIT_MICROS,
  LIVE_GENERATION_CALL_LIMIT,
  LIVE_MODEL,
  LIVE_SEARCH_CALL_LIMIT,
  startLiveBudgetGateway,
} from "./intelligence-live-budget-gateway";

const LIVE_ACK = "I_UNDERSTAND_PAID_REQUESTS";
const task = normalizeTaskInput({
  name: "宇树科技2024年股权融资核验",
  topics: ["宇树科技", "股权融资"],
  entities: ["宇树科技", "Unitree Robotics"],
  eventTypes: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" },
  outputInstructions: "仅比较公开来源召回、日期与正文取证，不生成投资结论。",
  isActive: true,
});
const start = new Date("2024-01-01T00:00:00.000Z");
const end = new Date("2024-12-31T23:59:59.999Z");
const queries = ["宇树科技 Unitree 2024 B2轮 融资", "宇树科技 2024 融资 官方 公告"];

function summarize(run: RetrievalRunResult) {
  const domains = [...new Set(run.results.map((item) => item.domain))];
  return {
    status: run.status,
    queryCount: run.queryCount,
    resultCount: run.results.length,
    domains,
    knownDates: run.results.filter((item) => item.publishedAt).length,
    unknownDates: run.results.filter((item) => !item.publishedAt).length,
    sources: run.results.map((item) => ({ title: item.title, url: item.url, domain: item.domain, publishedAt: item.publishedAt, query: item.query })),
  };
}

/** 两家供应商都执行相同的已知日期后过滤；日期未知保留为待核线索。 */
export function applyComparisonWindow(run: RetrievalRunResult, rangeStart: Date, rangeEnd: Date): RetrievalRunResult {
  return {
    ...run,
    results: run.results.filter((item) => {
      if (!item.publishedAt) return true;
      const timestamp = new Date(item.publishedAt).getTime();
      return !Number.isFinite(timestamp) || (timestamp >= rangeStart.getTime() && timestamp <= rangeEnd.getTime());
    }),
    coverageCapability: "coarse",
  };
}

export async function loadDeepSeekComparisonKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const userId = process.env.INTELLIGENCE_COMPARE_USER_ID;
  if (!userId) throw new Error("DEEPSEEK_API_KEY or INTELLIGENCE_COMPARE_USER_ID is required");
  if (process.env.INTELLIGENCE_COMPARE_DATABASE_SCOPE !== "isolated") {
    throw new Error("settings BYOK may only be read when INTELLIGENCE_COMPARE_DATABASE_SCOPE=isolated");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for settings BYOK comparison");
  const database = new URL(connectionString);
  if (!(database.hostname === "127.0.0.1" || database.hostname === "localhost") || database.pathname !== "/aivestor_test") {
    throw new Error("settings BYOK comparison refuses non-loopback or non-aivestor_test databases");
  }
  const access = await getGenerationAccess(userId);
  if (!access || access.source !== "custom" || access.credentials.usingFreeQuota || access.credentials.provider !== "deepseek") {
    throw new Error("the isolated test user must own a DeepSeek BYOK credential");
  }
  return access.credentials.apiKey;
}

async function evidenceFor(urls: string[], fetcher: (url: string) => Promise<EvidenceResult>) {
  const rows = [];
  for (const url of urls.slice(0, 2)) {
    const result = await fetcher(url);
    rows.push({ url, status: result.evidenceStatus, title: result.title || null, textChars: result.text.length, failureReason: result.failureReason || null });
  }
  return rows;
}

async function main() {
  if (process.env.INTELLIGENCE_COMPARE_LIVE !== LIVE_ACK) throw new Error("INTELLIGENCE_COMPARE_LIVE explicit acknowledgement is required");
  const deepSeekKey = await loadDeepSeekComparisonKey();
  const bailianKey = process.env.BAILIAN_API_KEY;
  if (!bailianKey) throw new Error("BAILIAN_API_KEY is required for this isolated comparison");
  const cnyLedgerPath = process.env.LIVE_BUDGET_LEDGER_PATH;
  const usdLedgerPath = process.env.DEEPSEEK_COMPARE_LEDGER_PATH;
  const outputPath = process.env.INTELLIGENCE_COMPARE_OUTPUT_PATH;
  if (!cnyLedgerPath || !usdLedgerPath || !outputPath) throw new Error("comparison ledger and output paths are required");

  const usdLedger = await PersistentDeepSeekComparisonLedger.open(usdLedgerPath);
  const gateway = await startLiveBudgetGateway({
    ledgerPath: cnyLedgerPath,
    upstreamApiKey: bailianKey,
    resume: true,
    limitMicros: LIVE_BUDGET_LIMIT_MICROS,
    generationCallLimit: LIVE_GENERATION_CALL_LIMIT,
    searchCallLimit: LIVE_SEARCH_CALL_LIMIT,
    fingerprintScope: "provider-comparison-20261104-unitree-two-query-v1",
  });

  try {
    const initialCny = gateway.ledger.snapshot();
    const initialReserved = initialCny.records.reduce((sum, record) => sum + record.reservedMicros, 0);
    const initialSearchCalls = initialCny.records.filter((record) => record.kind === "search").length;
    const initialGenerationCalls = initialCny.records.filter((record) => record.kind === "generation").length;
    if (initialCny.limitMicros !== 5_000_000 || initialCny.searchCallLimit !== 22 || initialCny.generationCallLimit !== 24
      || initialReserved !== 3_352_055 || initialSearchCalls !== 20 || initialGenerationCalls !== 24
      || initialCny.records.some((record) => record.status !== "completed")) {
      throw new Error("cumulative CNY ledger does not match the authorized baseline");
    }

    // This comparison hard-disables DeepSeek Fetch and model generation. Both
    // providers receive the same two public queries and historical window.
    const deepSeek = createDeepSeekSearchFetchAdapter({
      apiKey: deepSeekKey,
      maxAttempts: 1,
      concurrency: 1,
      budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
      durableAttemptLedger: usdLedger,
    });
    const bailian = createBailianRetrievalProvider({
      apiKey: "local-budget-gateway-only",
      model: LIVE_MODEL,
      endpoint: `${gateway.baseUrl}/bailian-search`,
    });
    const request = { input: task, start, end, queries };
    const deepSeekRun = applyComparisonWindow(await deepSeek.searchWeb(request), start, end);
    const bailianRun = applyComparisonWindow(await bailian.searchWeb(request), start, end);

    const deepSeekEvidence = await evidenceFor(deepSeekRun.results.map((item) => item.url), fetchPublicEvidence);
    const bailianEvidence = await evidenceFor(bailianRun.results.map((item) => item.url), fetchPublicEvidence);
    const deepSeekUrls = new Set(deepSeekRun.results.map((item) => item.url));
    const overlap = bailianRun.results.map((item) => item.url).filter((url) => deepSeekUrls.has(url));
    const finalCny = gateway.ledger.snapshot();
    const finalReserved = finalCny.records.reduce((sum, record) => sum + record.reservedMicros, 0);
    const finalSearchCalls = finalCny.records.filter((record) => record.kind === "search").length;
    const finalGenerationCalls = finalCny.records.filter((record) => record.kind === "generation").length;
    if (finalReserved > 5_000_000 || finalSearchCalls > 22 || finalGenerationCalls > 24) {
      throw new Error("post-comparison CNY budget invariant failed");
    }

    const result = {
      task: { name: task.name, queries, window: { start: start.toISOString(), end: end.toISOString() } },
      executedAt: new Date().toISOString(),
      deepseek: { ...summarize(deepSeekRun), evidence: deepSeekEvidence, usage: deepSeek.usageSnapshot() },
      bailian: { ...summarize(bailianRun), evidence: bailianEvidence },
      overlap: { exactUrlCount: overlap.length, urls: overlap },
      budgets: {
        deepseekUsd: usdLedger.snapshot(),
        bailianCny: {
          sessionId: finalCny.sessionId,
          limitMicros: finalCny.limitMicros,
          initialReservedMicros: initialReserved,
          finalReservedMicros: finalReserved,
          initialSearchCalls,
          finalSearchCalls,
          generationCalls: finalGenerationCalls,
        },
      },
      limitations: [
        "一次公开任务不能代表总体召回率",
        "未知发布日期保留为待核线索，不计作时间窗精确命中",
        "DeepSeek 费用为客户端保守预留与已确认非空响应估算，不是账单金额",
        "本次关闭 DeepSeek Fetch 和模型生成；两家都使用本地安全取证。",
        "未命中来源不能被解释为该来源或事件不存在。",
      ],
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({
      outputPath,
      deepseekStatus: deepSeekRun.status,
      deepseekResults: deepSeekRun.results.length,
      bailianStatus: bailianRun.status,
      bailianResults: bailianRun.results.length,
      finalCnyReservedMicros: finalReserved,
      finalCnySearchCalls: finalSearchCalls,
      deepseekUsdReservedMicros: usdLedger.snapshot().attempts.reduce((sum, attempt) => sum + attempt.reservedUsdMicros, 0),
    }));
  } finally {
    await gateway.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
