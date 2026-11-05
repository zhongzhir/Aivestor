import assert from "node:assert/strict";
import { createIntelligenceResearchInfrastructure, normalizeTaskInput } from "@/lib/intelligence";
import {
  DeepSeekSearchFetchBudget,
  createDeepSeekEvidenceAcquirer,
  createDeepSeekSearchFetchAdapter,
  deepSeekHistoricalQuery,
} from "@/lib/intelligenceDeepSeekAdapter";
import type { EvidenceCandidate, EvidenceResult } from "@/lib/intelligenceEvidence";
import { applyComparisonWindow, loadDeepSeekComparisonKey } from "./intelligence-search-provider-compare";

const input = normalizeTaskInput({
  name: "2024年机器人股权融资",
  topics: ["机器人"],
  eventTypes: ["融资"],
  lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T23:59:59.999Z" },
  outputInstructions: "核验公开融资事项。",
  isActive: true,
});
const request = { input, start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-12-31T23:59:59.999Z"), queries: ["机器人 B2轮 融资"] };
const dummyKey = "local-test-token-not-a-secret";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function evidence(status: EvidenceResult["evidenceStatus"], text = ""): EvidenceResult {
  return { url: "https://example.com/article", finalUrl: "https://example.com/article", text, evidenceStatus: status, ...(status === "unavailable" ? { failureReason: "controlled_failure" } : {}) };
}

async function main() {
  const disabledInfrastructure = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://api.deepseek.com/v1", usingFreeQuota: false },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "false" },
    { authorizeDeepSeekSearchByok: true },
  );
  assert.equal(disabledInfrastructure.deepSeekAdapter, undefined, "配置模型 Key 不得自动开启独立计费的 Search/Fetch");
  assert.equal(disabledInfrastructure.deepSeekAudit().blockReason, "feature_disabled");
  const noRunAuthorization = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://api.deepseek.com/v1", usingFreeQuota: false },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true" },
  );
  assert.equal(noRunAuthorization.deepSeekAdapter, undefined, "全局功能开关不能替代单次费用授权");
  assert.equal(noRunAuthorization.deepSeekAudit().blockReason, "single_run_not_authorized");
  const platformInfrastructure = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://api.deepseek.com/v1", usingFreeQuota: true },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true" },
    { authorizeDeepSeekSearchByok: true, authorizeDeepSeekFetchByok: true },
  );
  assert.equal(platformInfrastructure.deepSeekAdapter, undefined, "平台代付凭据不得产生额外 Search/Fetch 费用");
  assert.equal(platformInfrastructure.deepSeekAudit().blockReason, "platform_billing_disabled");
  const enabledInfrastructure = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://api.deepseek.com/v1", usingFreeQuota: false },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true", INTELLIGENCE_DEEPSEEK_FETCH_MODE: "fallback", INTELLIGENCE_DEEPSEEK_SEARCH_MAX_REQUESTS: "2", INTELLIGENCE_DEEPSEEK_FETCH_MAX_REQUESTS: "2" },
    { authorizeDeepSeekSearchByok: true },
  );
  assert.ok(enabledInfrastructure.deepSeekAdapter);
  assert.equal(enabledInfrastructure.acquireEvidence, undefined, "Fetch 还需要独立的单次授权");
  assert.equal(enabledInfrastructure.deepSeekAudit().fetchMode, "off");
  const fetchAuthorizedInfrastructure = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://api.deepseek.com/v1", usingFreeQuota: false },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true", INTELLIGENCE_DEEPSEEK_FETCH_MODE: "fallback" },
    { authorizeDeepSeekSearchByok: true, authorizeDeepSeekFetchByok: true },
  );
  assert.equal(typeof fetchAuthorizedInfrastructure.acquireEvidence, "function");
  const customEndpointInfrastructure = createIntelligenceResearchInfrastructure(
    { provider: "deepseek", apiKey: dummyKey, baseURL: "https://proxy.example.com/v1", usingFreeQuota: false },
    { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true", INTELLIGENCE_DEEPSEEK_FETCH_MODE: "prefer" },
    { authorizeDeepSeekSearchByok: true, authorizeDeepSeekFetchByok: true },
  );
  assert.equal(customEndpointInfrastructure.deepSeekAdapter, undefined, "不得把用户 DeepSeek Key 发送到自定义 Search/Fetch endpoint");
  for (const unsafeBaseURL of ["https://api.deepseek.com/custom", "https://user@api.deepseek.com/v1", "https://api.deepseek.com:444/v1"]) {
    const unsafeInfrastructure = createIntelligenceResearchInfrastructure(
      { provider: "deepseek", apiKey: dummyKey, baseURL: unsafeBaseURL, usingFreeQuota: false },
      { INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true" },
      { authorizeDeepSeekSearchByok: true },
    );
    assert.equal(unsafeInfrastructure.deepSeekAdapter, undefined, `非官方端点形态必须失败关闭：${unsafeBaseURL}`);
    assert.throws(
      () => createDeepSeekSearchFetchAdapter({ apiKey: dummyKey, baseURL: unsafeBaseURL }),
      /official API endpoint/,
      `底层适配器也必须拒绝非官方端点：${unsafeBaseURL}`,
    );
  }

  const ranged = deepSeekHistoricalQuery("机器人融资 after:2026-01-01", request.start, request.end);
  assert.match(ranged, /after:2023-12-31/);
  assert.match(ranged, /before:2025-01-01/);
  assert.doesNotMatch(ranged, /after:2026-01-01/);
  assert.ok([...ranged].length <= 128);

  const seen: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  const budget = new DeepSeekSearchFetchBudget(4, 4);
  const adapter = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    baseURL: "https://api.deepseek.com/v1",
    budget,
    maxAttempts: 1,
    fetchImpl: async (url, init) => {
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body || "{}")),
      });
      return json({ results: [
        { title: "窗口内事件", url: "https://news.example.com/2024/in-window", snippet: "2024融资", summary: "2024融资长摘要", site_name: "示例媒体", date: "2024-06-01T00:00:00Z", rerank_score: 2.5, authority: 3, content: "" },
        { title: "窗口外事件", url: "https://news.example.com/2025/outside", snippet: "2025融资", summary: "2025融资长摘要", site_name: "示例媒体", date: "2025-01-02T00:00:00Z", rerank_score: 2.4, authority: 3, content: "" },
        { title: "日期未知线索", url: "https://news.example.com/unknown", snippet: "待核日期", summary: "待核日期长摘要", site_name: "示例媒体", date: null, rerank_score: 1.8, authority: 2, content: "" },
      ] });
    },
  });
  const run = await adapter.searchWeb(request);
  assert.equal(run.status, "success");
  assert.deepEqual(run.results.map((item) => item.title), ["窗口内事件", "日期未知线索"], "已知越界日期必须剔除；未知日期保留为待核线索");
  assert.equal(run.coverageCapability, "coarse", "未知日期存在时不得声称精确覆盖");
  assert.equal(seen[0]?.url, "https://api.deepseek.com/v1/tools/search");
  assert.equal(seen[0]?.authorization, `Bearer ${dummyKey}`);
  assert.equal(seen[0]?.body.need_content, false, "Search 不应重复购买正文；正文由 Fetch/本地取证独立处理");
  assert.match(String(seen[0]?.body.query), /after:2023-12-31 before:2025-01-01/);
  assert.equal(adapter.usageSnapshot().billableSearch, 1);
  assert.equal(adapter.usageSnapshot().searchCompleted, 1);
  assert.equal(adapter.usageSnapshot().reservedUsdMicros, 750);

  const durableEvents: string[] = [];
  const durableAdapter = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 1,
    budget: new DeepSeekSearchFetchBudget(1, 0, 750),
    durableAttemptLedger: {
      reserve: async (kind, amount) => { durableEvents.push(`reserve:${kind}:${amount}`); return "durable-1"; },
      complete: async (id, billable, amount) => { durableEvents.push(`complete:${id}:${billable}:${amount}`); },
      fail: async (id) => { durableEvents.push(`fail:${id}`); },
      uncertain: async (id) => { durableEvents.push(`uncertain:${id}`); },
    },
    fetchImpl: async () => {
      assert.deepEqual(durableEvents, ["reserve:search:750"], "持久预算必须在 transport 调用前完成");
      return json({ results: [{ title: "持久审计结果", url: "https://example.com/durable", snippet: "摘要", site_name: "示例", date: null }] });
    },
  });
  await durableAdapter.searchWeb(request);
  assert.deepEqual(durableEvents, ["reserve:search:750", "complete:durable-1:true:750"]);

  let invalidCompleteCalls = 0;
  const invalidAdapter = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 1,
    budget: new DeepSeekSearchFetchBudget(1, 0, 750),
    durableAttemptLedger: {
      reserve: async () => "durable-invalid",
      complete: async () => { invalidCompleteCalls++; },
      fail: async () => {},
      uncertain: async () => {},
    },
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  const invalidRun = await invalidAdapter.searchWeb(request);
  assert.equal(invalidRun.errorCode, "invalid_response");
  assert.equal(invalidCompleteCalls, 1, "无效 200 响应只能结算一次，不能因结算逻辑再次进入解析异常分支");

  let retryCalls = 0;
  const retry = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 2,
    sleep: async () => {},
    budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
    fetchImpl: async () => ++retryCalls === 1 ? json({ error: { code: "rate_limit" } }, 429) : json({ results: [] }),
  });
  const retryRun = await retry.searchWeb(request);
  assert.equal(retryRun.status, "success");
  assert.equal(retryCalls, 2, "明确 429 可在预算内重试一次");
  assert.equal(retry.usageSnapshot().billableSearch, 0, "失败和空结果按官方规则不计入已确认可计费请求");

  let uncertainCalls = 0;
  const uncertain = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 2,
    budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
    fetchImpl: async () => { uncertainCalls++; throw new Error("controlled network loss"); },
  });
  const uncertainRun = await uncertain.searchWeb(request);
  assert.equal(uncertainRun.status, "failed");
  assert.equal(uncertainRun.errorCode, "request_uncertain");
  assert.equal(uncertainCalls, 1, "无响应的网络错误结果不确定，禁止自动重复潜在计费请求");
  assert.equal(uncertain.usageSnapshot().uncertain, 1);
  assert.equal(uncertain.usageSnapshot().searchUncertain, 1);

  let bodyLossCalls = 0;
  const bodyLoss = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 2,
    budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
    fetchImpl: async () => {
      bodyLossCalls++;
      return { ok: true, status: 200, text: async () => { throw new Error("controlled body stream loss"); } } as unknown as Response;
    },
  });
  const bodyLossRun = await bodyLoss.searchWeb(request);
  assert.equal(bodyLossRun.errorCode, "request_uncertain");
  assert.equal(bodyLossCalls, 1, "HTTP 200 后响应流丢失也不得自动重复潜在计费请求");
  assert.equal(bodyLoss.usageSnapshot().uncertain, 1);

  let cappedCalls = 0;
  const capped = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 1,
    concurrency: 1,
    budget: new DeepSeekSearchFetchBudget(1, 0, 750),
    fetchImpl: async () => { cappedCalls++; return json({ results: [{ title: "受控结果", url: `https://example.com/${cappedCalls}`, snippet: "摘要", summary: "摘要", site_name: "示例", date: null, rerank_score: 2, authority: 2, content: "" }] }); },
  });
  const cappedRun = await capped.searchWeb({ ...request, queries: ["查询一", "查询二"] });
  assert.equal(cappedRun.status, "partial");
  assert.equal(cappedRun.errorCode, "budget_exhausted");
  assert.equal(cappedCalls, 1, "硬上限后不得发出第二个请求");

  let concurrentTransportCalls = 0;
  const completedBatches: string[] = [];
  const concurrent = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 1,
    concurrency: 2,
    budget: new DeepSeekSearchFetchBudget(4, 0, 3_000),
    fetchImpl: async (_url, init) => {
      concurrentTransportCalls += 1;
      const body = JSON.parse(String(init?.body || "{}")) as { query?: string };
      const label = body.query?.includes("分支一") ? "分支一" : "分支二";
      if (label === "分支二") await new Promise((resolve) => setTimeout(resolve, 25));
      return json({ results: [{ title: label, url: `https://example.com/${encodeURIComponent(label)}`, snippet: "摘要", site_name: "示例", date: null }] });
    },
  });
  await assert.rejects(
    concurrent.searchWeb({
      ...request,
      queries: ["分支一", "分支二", "不得发出三", "不得发出四"],
      onBatch: async (batch) => {
        if (batch.query === "分支一") throw new Error("INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED");
        completedBatches.push(batch.query);
      },
    }),
    /INTELLIGENCE_PIPELINE_CHECKPOINT_FAILED/,
  );
  assert.equal(concurrentTransportCalls, 2, "持久化失败后只等待已经在途的分支，不得领取后续查询");
  assert.deepEqual(completedBatches, ["分支二"], "异常返回前必须等待另一在途分支完成候选持久化");
  assert.equal(concurrent.usageSnapshot().searchCompleted, 2, "两个已完成外部请求都必须结算，不能因分支异常丢账");

  let fetchCalls = 0;
  const fetchAdapter = createDeepSeekSearchFetchAdapter({
    apiKey: dummyKey,
    maxAttempts: 2,
    sleep: async () => {},
    validateUrl: async (value) => new URL(value),
    budget: new DeepSeekSearchFetchBudget(0, 2, 1_500),
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://api.deepseek.com/v1/tools/fetch");
      fetchCalls++;
      return fetchCalls === 1 ? json({ error: { code: "server_error" } }, 500) : json({ title: "已取证文章", content: "有效正文".repeat(300) });
    },
  });
  const fetched = await fetchAdapter.fetchEvidence("https://example.com/article");
  assert.equal(fetched.evidenceStatus, "full");
  assert.equal(fetchCalls, 2, "明确 5xx 可在独立 Fetch 预算内重试");
  assert.equal(fetchAdapter.usageSnapshot().billableFetch, 1);
  assert.equal(fetchAdapter.usageSnapshot().fetchFailed, 1);
  assert.equal(fetchAdapter.usageSnapshot().fetchCompleted, 1);

  let privateFetchCalls = 0;
  const privateGuard = createDeepSeekSearchFetchAdapter({ apiKey: dummyKey, fetchImpl: async () => { privateFetchCalls++; return json({ title: "", content: "" }); } });
  const privateResult = await privateGuard.fetchEvidence("http://127.0.0.1/private");
  assert.equal(privateResult.evidenceStatus, "unavailable");
  assert.equal(privateFetchCalls, 0, "私网 URL 必须在传给第三方 Fetch 前拒绝");

  let remoteCalls = 0;
  let localCalls = 0;
  const remote = { fetchEvidence: async () => { remoteCalls++; return evidence("full", "远程正文".repeat(300)); } };
  const localUnavailable = async () => { localCalls++; return evidence("unavailable"); };
  const fallback = createDeepSeekEvidenceAcquirer(remote, { mode: "fallback", localFetcher: localUnavailable });
  const fallbackRun = await fallback([{ title: "文章", sourceUrl: "https://example.com/article", origin: "web-search", content: "" } as EvidenceCandidate]);
  assert.equal(fallbackRun.candidates[0]?.evidenceStatus, "full");
  assert.equal(localCalls, 1);
  assert.equal(remoteCalls, 1, "fallback 仅在本地安全取证失败后调用 DeepSeek Fetch");

  remoteCalls = 0;
  localCalls = 0;
  const localFull = async () => { localCalls++; return evidence("full", "本地正文".repeat(300)); };
  const noPaidFallback = createDeepSeekEvidenceAcquirer(remote, { mode: "fallback", localFetcher: localFull });
  await noPaidFallback([{ title: "文章", sourceUrl: "https://example.com/article", origin: "web-search", content: "" } as EvidenceCandidate]);
  assert.equal(localCalls, 1);
  assert.equal(remoteCalls, 0, "本地取证成功时不得增加 Fetch 请求");

  const comparisonArtifact = {
    task: input.name,
    window: { start: request.start.toISOString(), end: request.end.toISOString() },
    provider: "deepseek-web",
    sources: run.results.map((item) => ({ title: item.title, url: item.url, publishedAt: item.publishedAt, query: item.query })),
    usage: adapter.usageSnapshot(),
  };
  assert.equal(comparisonArtifact.task, input.name);
  assert.ok(comparisonArtifact.sources.every((source) => source.url && source.title), "比较产物必须保留同任务、时间窗、标题和来源 URL");

  const commonWindowInput = {
    status: "success" as const,
    queryCount: 1,
    coverageCapability: "exact" as const,
    results: [
      { title: "窗口内", url: "https://example.com/in", snippet: "in", siteName: "example", domain: "example.com", sourceTier: "C" as const, publishedAt: "2024-06-01T00:00:00.000Z", query: "same" },
      { title: "窗口外", url: "https://example.com/out", snippet: "out", siteName: "example", domain: "example.com", sourceTier: "C" as const, publishedAt: "2025-01-02T00:00:00.000Z", query: "same" },
      { title: "日期未知", url: "https://example.com/unknown", snippet: "unknown", siteName: "example", domain: "example.com", sourceTier: "C" as const, publishedAt: null, query: "same" },
    ],
  };
  const deepSeekComparable = applyComparisonWindow(commonWindowInput, request.start, request.end);
  const bailianComparable = applyComparisonWindow({ ...commonWindowInput, results: [...commonWindowInput.results] }, request.start, request.end);
  assert.deepEqual(deepSeekComparable.results.map((item) => item.url), bailianComparable.results.map((item) => item.url));
  assert.deepEqual(deepSeekComparable.results.map((item) => item.title), ["窗口内", "日期未知"], "两家都剔除已知越界日期并保留未知日期线索");
  assert.equal(deepSeekComparable.coverageCapability, "coarse");

  const previousCompareEnv = {
    key: process.env.DEEPSEEK_API_KEY,
    user: process.env.INTELLIGENCE_COMPARE_USER_ID,
    scope: process.env.INTELLIGENCE_COMPARE_DATABASE_SCOPE,
    database: process.env.DATABASE_URL,
  };
  delete process.env.DEEPSEEK_API_KEY;
  process.env.INTELLIGENCE_COMPARE_USER_ID = "00000000-0000-4000-8000-000000000001";
  process.env.INTELLIGENCE_COMPARE_DATABASE_SCOPE = "isolated";
  process.env.DATABASE_URL = "postgresql://local.invalid@production.example/aivestor";
  await assert.rejects(loadDeepSeekComparisonKey(), /refuses non-loopback/, "设置页 BYOK 对比不得连接非本机测试库");
  if (previousCompareEnv.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousCompareEnv.key;
  if (previousCompareEnv.user === undefined) delete process.env.INTELLIGENCE_COMPARE_USER_ID; else process.env.INTELLIGENCE_COMPARE_USER_ID = previousCompareEnv.user;
  if (previousCompareEnv.scope === undefined) delete process.env.INTELLIGENCE_COMPARE_DATABASE_SCOPE; else process.env.INTELLIGENCE_COMPARE_DATABASE_SCOPE = previousCompareEnv.scope;
  if (previousCompareEnv.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousCompareEnv.database;

  console.log("intelligence DeepSeek Search/Fetch adapter tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
