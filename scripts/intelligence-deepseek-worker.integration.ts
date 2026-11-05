import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AICompletionTruncatedError } from "@/lib/ai";
import { pool, query } from "@/lib/db";
import { createIntelligenceResearchInfrastructure, type BriefResult, type DeepSeekSearchFetchAudit } from "@/lib/intelligence";
import { createIntelligenceGenerationProvider } from "@/lib/intelligenceProvider";
import { createDeepSeekSearchFetchAdapter, DeepSeekSearchFetchBudget } from "@/lib/intelligenceDeepSeekAdapter";
import { claimNextIntelligenceRun, createDeepSeekGenerationRunAttemptLedger, createIntelligenceRun, processIntelligenceRunById, retryIntelligenceRun, runClaimedIntelligenceRun } from "@/lib/intelligenceRuns";
import type { GenerationAccess } from "@/lib/intelligenceGeneration";
import { DEEPSEEK_GENERATION_MAX_REQUESTS, quoteDeepSeekGenerationReservation } from "@/lib/intelligenceDeepSeekGenerationBudget";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const database = new URL(connectionString);
const isCoreV2IsolatedDatabase = database.hostname === "127.0.0.1"
  && database.port === "55435"
  && database.pathname === "/aivestor_core_v2_test";
if (!isCoreV2IsolatedDatabase) {
  throw new Error("DeepSeek worker audit test refuses every database except the dedicated core-v2 target");
}

const userId = "00000000-0000-4000-8000-000000000001";
const dummyApiKey = ["local", "worker", "fixture"].join("-");
const dummyCredentials = {
  provider: "deepseek" as const,
  apiKey: dummyApiKey,
  baseURL: "https://api.deepseek.com/v1",
  model: "deepseek-flash",
};

async function task(name: string): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,event_types,source_policy)
     VALUES ($1,$2,$3,'["机器人"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,
             '','manual',NULL,true,'["融资"]'::jsonb,'{}'::jsonb)`,
    [id, userId, name],
  );
  return id;
}

function emptyBrief(name: string, start: string, end: string): BriefResult {
  return {
    taskName: name,
    coverageStart: start,
    coverageEnd: end,
    generatedAt: end,
    itemCount: 0,
    importantFacts: [],
    trendSignals: [],
    otherItems: [],
    sourceList: [],
    metadata: {
      overview: "受控离线 worker 测试未生成市场结论。",
      origins: ["controlled-test"],
      generationProvider: "controlled",
      generationModel: null,
      retrieval: {
        status: "partial",
        providers: [],
        searchCandidates: 0,
        relevancePassed: 0,
        relevanceDropped: 0,
        evidence: { full: 0, partial: 0, unavailable: 0 },
        final: { facts: 0, clues: 0, trends: 0 },
        sources: [],
      },
    },
  };
}

function access(source: "custom" | "platform"): GenerationAccess {
  return {
    source,
    credentials: { ...dummyCredentials, usingFreeQuota: source === "platform", ...(source === "platform" ? { tokensRemaining: 100_000 } : {}) },
  };
}

function qwenByokAccess(): GenerationAccess {
  return {
    source: "custom",
    credentials: {
      provider: "qwen",
      apiKey: "offline-qwen-must-not-run",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      usingFreeQuota: false,
    },
  };
}

function assertSafeAudit(value: unknown): DeepSeekSearchFetchAudit {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(dummyApiKey), false, "审计不得保存 Key");
  assert.doesNotMatch(serialized, /公开机器人融资/, "审计不得保存查询文本");
  return value as DeepSeekSearchFetchAudit;
}

async function runControlledCoverageDiagnosticCase(
  label: string,
  searchRows: Array<Record<string, unknown>>,
  evidence?: { status: "full" | "partial"; content: string },
): Promise<void> {
  const taskId = await task(label);
  const run = await createIntelligenceRun({
    userId,
    taskId,
    idempotencyKey: `coverage:${taskId}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  let generationCalls = 0;
  let searchCalls = 0;
  let unexpectedToolCalls = 0;
  const processed = await processIntelligenceRunById(run.id, userId, `coverage-worker:${label}`.slice(0, 120), {
    getGenerationAccess: async () => access("custom"),
    testOnlyInfrastructure: {
      deepSeekFetchImpl: async () => {
        searchCalls++;
        return new Response(JSON.stringify({ results: searchRows }), { status: 200, headers: { "content-type": "application/json" } });
      },
      generationToolChatImpl: async () => {
        unexpectedToolCalls++;
        throw new Error("V2 deterministic coverage diagnostic must not invoke the legacy tool agent");
      },
      generationStreamChatImpl: async function* (request) {
        generationCalls++;
        request.onUsage?.({ inputTokens: 200, outputTokens: 80 });
        yield JSON.stringify({
          facts: [],
          g: searchRows.length ? ["已读来源未形成与主题相关的可核验事项，粗检索不能证明没有其他事件"] : ["搜索未返回来源"],
          c: "low",
        });
      },
      ...(evidence ? {
        testEvidenceAcquirer: async (candidates) => ({
          candidates: candidates.map((candidate) => ({
            ...candidate,
            content: evidence.content,
            evidenceStatus: evidence.status,
          })),
          stats: {
            attempted: candidates.length,
            full: evidence.status === "full" ? candidates.length : 0,
            partial: evidence.status === "partial" ? candidates.length : 0,
            unavailable: 0,
          },
        }),
      } : {}),
    },
  });
  assert.equal(processed, run.id);
  assert.equal(searchCalls, 2, "V2 validation authorizes and persists both planned Search queries");
  assert.equal(generationCalls, evidence ? 1 : 0, "V2 only generates after usable evidence exists");
  assert.equal(unexpectedToolCalls, 0);
  const rows = await query<{
    status: string;
    retrieval_status: string;
    provider_call_state: string;
    error_code: string | null;
    metadata: BriefResult["metadata"];
    search_attempts: string;
    generation_attempts: string;
    unsettled_attempts: string;
  }>(
    `SELECT r.status,r.retrieval_status,r.provider_call_state,r.error_code,b.metadata,
            COUNT(*) FILTER (WHERE a.capability='search')::text AS search_attempts,
            COUNT(*) FILTER (WHERE a.capability='generation')::text AS generation_attempts,
            COUNT(*) FILTER (WHERE a.status IN ('reserved','uncertain'))::text AS unsettled_attempts
       FROM intelligence_runs r
       JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
       LEFT JOIN intelligence_run_external_attempts a ON a.run_id=r.id AND a.user_id=r.user_id
      WHERE r.id=$1
      GROUP BY r.id,b.id`,
    [run.id],
  );
  const stored = rows[0];
  assert.ok(stored);
  assert.equal(stored.status, "partial");
  assert.equal(stored.retrieval_status, "success", "provider execution succeeded even though coarse coverage remains insufficient");
  assert.equal(stored.provider_call_state, "completed");
  assert.equal(stored.error_code, null);
  assert.equal(stored.metadata.retrieval.status, "success");
  assert.equal(stored.metadata.retrieval.coverageConclusion, "insufficient_evidence");
  assert.match(stored.metadata.overview, /不代表|不等于|不能视为完整覆盖|无法判断/);
  assert.equal(Number(stored.search_attempts), 2);
  assert.equal(Number(stored.generation_attempts), evidence ? 1 : 0);
  assert.equal(Number(stored.unsettled_attempts), 0);
  assert.equal(JSON.stringify(stored).includes(dummyApiKey), false);
}

function verifiedNoNewBrief(name: string, start: string, end: string): BriefResult {
  const url = "https://example.com/verified-empty-scope";
  return {
    taskName: name,
    coverageStart: start,
    coverageEnd: end,
    generatedAt: end,
    itemCount: 0,
    importantFacts: [],
    trendSignals: [],
    otherItems: [],
    sourceList: [],
    metadata: {
      overview: "在已核验来源范围内没有符合条件的事项。",
      origins: ["controlled-test"],
      generationProvider: "controlled",
      generationModel: null,
      retrieval: {
        status: "success",
        providers: [{ provider: "controlled", attempted: true, succeeded: true, queryCount: 1, resultCount: 1, status: "success", coverageCapability: "exact" }],
        searchCandidates: 1,
        relevancePassed: 0,
        relevanceDropped: 1,
        evidence: { full: 1, partial: 0, unavailable: 0 },
        final: { facts: 0, clues: 0, trends: 0 },
        coverageConclusion: "verified_no_matching_items",
        sources: [{ url, title: "已核验范围", source: "受控来源", sourceTier: "S", provider: "controlled", publishedAt: end, fetchedAt: end, evidenceStatus: "full", exclusionReason: null }],
      },
    },
  };
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "true",
    INTELLIGENCE_DEEPSEEK_FETCH_MODE: "off",
    BAILIAN_API_KEY: "offline-bailian-must-not-run",
    TAVILY_API_KEY: "offline-tavily-must-not-run",
  });
  await query(
    `INSERT INTO users (id,email,name,password_hash,auth_provider)
     VALUES ($1,$2,'DeepSeek worker fixture','offline','credentials')
     ON CONFLICT (id) DO NOTHING`,
    [userId, `deepseek-worker-${userId}@example.test`],
  );

  const missingCapTask = await task("DeepSeek 费用授权必须带硬上限");
  await assert.rejects(
    createIntelligenceRun({
      userId,
      taskId: missingCapTask,
      idempotencyKey: `missing-cap:${missingCapTask}`,
      authorizeDeepSeekGeneration: true,
    }),
    /USD 0\.10/,
  );

  const byokTask = await task("DeepSeek BYOK 单次授权审计");
  const byokRun = await createIntelligenceRun({
    userId,
    taskId: byokTask,
    idempotencyKey: `byok:${byokTask}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  const byokClaim = await claimNextIntelligenceRun("deepseek-byok-worker");
  assert.equal(byokClaim?.id, byokRun.id);
  await runClaimedIntelligenceRun(byokClaim!, "deepseek-byok-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input, _now, _slot, credentials, _runId, _defer, execution) => {
      let deepSeekCalls = 0;
      let unapprovedProviderCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        unapprovedProviderCalls += 1;
        throw new Error("unapproved provider transport invoked");
      };
      const infrastructure = createIntelligenceResearchInfrastructure(credentials, process.env, {
        ...execution,
        deepSeekFetchImpl: async () => {
          deepSeekCalls += 1;
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        },
      });
      assert.ok(infrastructure.deepSeekAdapter, "BYOK + 单次授权才可启用 Search");
      try {
        const retrieval = await infrastructure.retrieval.retrieve({
          input,
          start: new Date(byokClaim!.coverage_start),
          end: new Date(byokClaim!.coverage_end),
          queries: ["公开机器人融资"],
        });
        assert.deepEqual(retrieval.providers.map((provider) => provider.provider), ["deepseek-web"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(deepSeekCalls, 1);
      assert.equal(unapprovedProviderCalls, 0, "DeepSeek-only run 不得构造或调用百炼/Tavily transport");
      await execution?.onDeepSeekSearchFetchAudit?.(infrastructure.deepSeekAudit());
      return { id: "", brief: emptyBrief(input.name, byokClaim!.coverage_start, byokClaim!.coverage_end) };
    },
  });
  const byokStored = await query<{ status: string; external_cost_authorization: Record<string, unknown>; usage: Record<string, unknown> }>(
    "SELECT status,external_cost_authorization,usage FROM intelligence_runs WHERE id=$1",
    [byokRun.id],
  );
  assert.equal(byokStored[0].status, "partial", "检索成功但零结果不能冒充已核验无新增");
  assert.equal(byokStored[0].external_cost_authorization.deepSeekSearch, true);
  assert.equal(byokStored[0].external_cost_authorization.deepSeekGeneration, true);
  assert.equal(byokStored[0].external_cost_authorization.generationRequestLimit, 1);
  assert.equal(byokStored[0].external_cost_authorization.maxUsdMicros, 100_000);
  assert.equal(byokStored[0].external_cost_authorization.retrievalProviderMode, "deepseek-only");
  const byokAudit = assertSafeAudit(byokStored[0].usage.deepseekSearchFetch);
  assert.equal(byokAudit.credentialSource, "byok");
  assert.equal(byokAudit.enabled, true);
  assert.equal(byokAudit.fetchMode, "off");
  assert.equal(byokAudit.usage.searchAttempts, 1);
  assert.equal(byokAudit.usage.searchCompleted, 1);
  assert.equal(byokAudit.usage.fetchAttempts, 0);
  assert.equal(byokAudit.usage.reservedUsdMicros, 750);

  await runControlledCoverageDiagnosticCase("DeepSeek 空搜索结果必须部分完成", []);
  await runControlledCoverageDiagnosticCase("DeepSeek 有来源但未读正文必须部分完成", [{
    title: "受控机器人融资来源",
    url: "https://example.com/controlled-robot-financing",
    summary: "该来源仅用于验证未读正文时的覆盖状态。",
    site_name: "example.com",
    date: new Date().toISOString(),
  }]);
  await runControlledCoverageDiagnosticCase("DeepSeek 无关完整正文不得推断无新增", [{
    title: "机器人产品体验文章",
    url: "https://example.com/unrelated-robot-review",
    summary: "文章讨论产品体验，不包含融资事件。",
    site_name: "example.com",
    date: new Date().toISOString(),
  }], {
    status: "full",
    content: "这是一篇与融资主题无关的机器人产品体验文章。".repeat(80),
  });
  await runControlledCoverageDiagnosticCase("DeepSeek 截断正文不得推断无新增", [{
    title: "机器人行业动态节选",
    url: "https://example.com/truncated-robot-update",
    summary: "搜索摘要不包含足够的资本事件证据。",
    site_name: "example.com",
    date: new Date().toISOString(),
  }], {
    status: "partial",
    content: "正文仅返回不完整节选，无法证明主题范围内没有其他事项。",
  });

  const verifiedTask = await task("仅核验证据后才可无新增");
  const verifiedRun = await createIntelligenceRun({
    userId,
    taskId: verifiedTask,
    idempotencyKey: `verified-empty:${verifiedTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const verifiedProcessed = await processIntelligenceRunById(verifiedRun.id, userId, "verified-empty-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input) => ({ id: "", brief: verifiedNoNewBrief(input.name, verifiedRun.coverage_start, verifiedRun.coverage_end) }),
  });
  assert.equal(verifiedProcessed, verifiedRun.id);
  const verifiedStored = await query<{ status: string; retrieval_status: string }>(
    "SELECT status,retrieval_status FROM intelligence_runs WHERE id=$1",
    [verifiedRun.id],
  );
  assert.equal(verifiedStored[0].status, "no_new_items");
  assert.equal(verifiedStored[0].retrieval_status, "success");

  const qwenByokTask = await task("DeepSeek-only 禁止 Qwen BYOK 生成");
  const qwenByokRun = await createIntelligenceRun({
    userId,
    taskId: qwenByokTask,
    idempotencyKey: `deepseek-only-qwen:${qwenByokTask}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  const qwenByokClaim = await claimNextIntelligenceRun("deepseek-only-qwen-worker");
  assert.equal(qwenByokClaim?.id, qwenByokRun.id);
  let qwenTransportEntered = false;
  await runClaimedIntelligenceRun(qwenByokClaim!, "deepseek-only-qwen-worker", {
    getGenerationAccess: async () => qwenByokAccess(),
    generateBrief: async () => {
      qwenTransportEntered = true;
      throw new Error("Qwen transport must not be entered for DeepSeek-only run");
    },
  });
  const qwenByokStored = await query<{
    status: string;
    error_code: string;
    provider_call_state: string;
    attempts: string;
  }>(
    `SELECT status,error_code,provider_call_state,
            (SELECT COUNT(*)::text FROM intelligence_run_external_attempts WHERE run_id=$1) AS attempts
       FROM intelligence_runs WHERE id=$1`,
    [qwenByokRun.id],
  );
  assert.equal(qwenTransportEntered, false);
  assert.equal(qwenByokStored[0].status, "blocked");
  assert.equal(qwenByokStored[0].error_code, "deepseek_generation_not_authorized");
  assert.equal(qwenByokStored[0].provider_call_state, "none");
  assert.equal(qwenByokStored[0].attempts, "0", "provider 不匹配时必须零外部尝试");

  const generationTask = await task("DeepSeek generation 持久预算审计");
  const generationRun = await createIntelligenceRun({
    userId,
    taskId: generationTask,
    idempotencyKey: `generation:${generationTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const generationClaim = await claimNextIntelligenceRun("deepseek-generation-worker");
  assert.equal(generationClaim?.id, generationRun.id);
  // Compatibility fixture: this row represents an authorization written
  // before generationRequestLimit was introduced. It retains the prior
  // six-request ceiling; new rows below are limited to one.
  await query(
    "UPDATE intelligence_runs SET external_cost_authorization=external_cost_authorization - 'generationRequestLimit' WHERE id=$1",
    [generationRun.id],
  );
  await runClaimedIntelligenceRun(generationClaim!, "deepseek-generation-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input, _now, _slot, _credentials, _runId, _defer, execution) => {
      const ledger = execution?.deepSeekGenerationDurableLedger;
      assert.ok(ledger, "真实 worker 必须注入 generation 持久预算账本");
      for (let index = 0; index < DEEPSEEK_GENERATION_MAX_REQUESTS; index++) {
        const reservation = await ledger.reserve(quoteDeepSeekGenerationReservation({ system: "offline", prompt: `public-${index}` }, "deepseek-flash"));
        await ledger.complete(reservation, { inputTokens: 100 + index, outputTokens: 20 });
      }
      await assert.rejects(
        ledger.reserve(quoteDeepSeekGenerationReservation({ system: "offline", prompt: "over-limit" }, "deepseek-flash")),
        /CALL_LIMIT/,
      );
      return { id: "", brief: emptyBrief(input.name, generationClaim!.coverage_start, generationClaim!.coverage_end) };
    },
  });
  const generationStored = await query<{
    status: string;
    usage: { deepseekGeneration: { completed: number; uncertain: number } } & Record<string, unknown>;
    attempts: string;
  }>(
    `SELECT status,usage,
            (SELECT COUNT(*)::text FROM intelligence_run_external_attempts
              WHERE run_id=$1 AND provider='deepseek' AND capability='generation') AS attempts
       FROM intelligence_runs WHERE id=$1`,
    [generationRun.id],
  );
  assert.equal(generationStored[0].status, "partial", "只有费用调用、没有来源证据时不能标为无新增");
  assert.equal(Number(generationStored[0].attempts), DEEPSEEK_GENERATION_MAX_REQUESTS);
  assert.equal(generationStored[0].usage.deepseekGeneration.completed, DEEPSEEK_GENERATION_MAX_REQUESTS);
  assert.equal(generationStored[0].usage.deepseekGeneration.uncertain, 0);
  assert.equal(JSON.stringify(generationStored[0].usage).includes(dummyApiKey), false);

  const concurrentTask = await task("DeepSeek generation 并发预留审计");
  const concurrentRun = await createIntelligenceRun({
    userId,
    taskId: concurrentTask,
    idempotencyKey: `generation-concurrent:${concurrentTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const concurrentClaim = await claimNextIntelligenceRun("deepseek-generation-concurrent-worker");
  assert.equal(concurrentClaim?.id, concurrentRun.id);
  const concurrentAuthorization = await query<{ external_cost_authorization: Record<string, unknown> }>(
    "SELECT external_cost_authorization FROM intelligence_runs WHERE id=$1",
    [concurrentRun.id],
  );
  assert.equal(concurrentAuthorization[0].external_cost_authorization.generationRequestLimit, 1);
  await runClaimedIntelligenceRun(concurrentClaim!, "deepseek-generation-concurrent-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input, _now, _slot, _credentials, _runId, _defer, execution) => {
      const ledger = execution?.deepSeekGenerationDurableLedger;
      assert.ok(ledger);
      const spec = quoteDeepSeekGenerationReservation({ system: "offline", prompt: "concurrency" }, "deepseek-flash");
      const results = await Promise.allSettled([ledger.reserve(spec), ledger.reserve(spec)]);
      const fulfilled = results.filter((item): item is PromiseFulfilledResult<string> => item.status === "fulfilled");
      const rejected = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
      assert.equal(fulfilled.length, 1, "并发预算预留只能有一个获得调用权");
      assert.equal(rejected.length, 1);
      assert.match(String(rejected[0].reason), /PREVIOUS_RESULT_UNCERTAIN/);
      await ledger.complete(fulfilled[0].value, { inputTokens: 80, outputTokens: 16 });
      await assert.rejects(
        ledger.reserve(spec),
        /CALL_LIMIT/,
        "单次授权完成后仍不得重放第二次 generation",
      );
      return { id: "", brief: emptyBrief(input.name, concurrentClaim!.coverage_start, concurrentClaim!.coverage_end) };
    },
  });
  const concurrentAttempts = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM intelligence_run_external_attempts WHERE run_id=$1 AND provider='deepseek' AND capability='generation'",
    [concurrentRun.id],
  );
  assert.equal(concurrentAttempts[0].count, "1", "并发预留不得创建第二笔可计费尝试");

  const tamperedTask = await task("DeepSeek generation 预留时重验 run 授权");
  const tamperedRun = await createIntelligenceRun({
    userId,
    taskId: tamperedTask,
    idempotencyKey: `generation-tampered:${tamperedTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const tamperedClaim = await claimNextIntelligenceRun("deepseek-generation-tampered-worker");
  assert.equal(tamperedClaim?.id, tamperedRun.id);
  await runClaimedIntelligenceRun(tamperedClaim!, "deepseek-generation-tampered-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input, _now, _slot, _credentials, _runId, _defer, execution) => {
      const ledger = execution?.deepSeekGenerationDurableLedger;
      assert.ok(ledger);
      await query(
        "UPDATE intelligence_runs SET external_cost_authorization=external_cost_authorization - 'maxUsdMicros' WHERE id=$1",
        [tamperedRun.id],
      );
      await assert.rejects(
        ledger.reserve(quoteDeepSeekGenerationReservation({ system: "offline", prompt: "tampered" }, "deepseek-flash")),
        /RUN_BUDGET_AUTHORIZATION_REQUIRED/,
      );
      return { id: "", brief: emptyBrief(input.name, tamperedClaim!.coverage_start, tamperedClaim!.coverage_end) };
    },
  });
  const tamperedAttempts = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM intelligence_run_external_attempts WHERE run_id=$1",
    [tamperedRun.id],
  );
  assert.equal(tamperedAttempts[0].count, "0", "run 级费用上限被移除后不得创建可计费预留");

  const platformTask = await task("DeepSeek 平台赠送额度默认运行");
  const platformRun = await createIntelligenceRun({
    userId,
    taskId: platformTask,
    idempotencyKey: `platform:${platformTask}`,
  });
  const platformClaim = await claimNextIntelligenceRun("deepseek-platform-worker");
  assert.equal(platformClaim?.id, platformRun.id);
  await runClaimedIntelligenceRun(platformClaim!, "deepseek-platform-worker", {
    getGenerationAccess: async () => access("platform"),
    generateBrief: async (_userId, _taskId, input) => ({
      id: "",
      brief: emptyBrief(input.name, platformRun.coverage_start, platformRun.coverage_end),
    }),
  });
  const platformStored = await query<{ status: string; error_code: string | null; attempts: string; quota_status: string | null }>(
    `SELECT status,error_code,
            (SELECT COUNT(*)::text FROM intelligence_run_external_attempts WHERE run_id=$1) AS attempts,
            (SELECT status FROM intelligence_quota_reservations WHERE run_id=$1 ORDER BY created_at DESC LIMIT 1) AS quota_status
       FROM intelligence_runs WHERE id=$1`,
    [platformRun.id],
  );
  assert.equal(platformStored[0].status, "partial");
  assert.equal(platformStored[0].error_code, null);
  assert.equal(platformStored[0].attempts, "0", "平台赠送额度不得误入用户自有 DeepSeek 美元账本");
  assert.equal(platformStored[0].quota_status, "consumed", "平台运行必须通过平台额度 reservation 结算");

  const failureTask = await task("DeepSeek Search 不确定失败审计");
  const failureRun = await createIntelligenceRun({
    userId,
    taskId: failureTask,
    idempotencyKey: `uncertain:${failureTask}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const failureClaim = await claimNextIntelligenceRun("deepseek-failure-worker");
  assert.equal(failureClaim?.id, failureRun.id);
  await runClaimedIntelligenceRun(failureClaim!, "deepseek-failure-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input, _now, _slot, credentials, _runId, _defer, execution) => {
      const infrastructure = createIntelligenceResearchInfrastructure(credentials, process.env, execution);
      const adapter = createDeepSeekSearchFetchAdapter({
        ...dummyCredentials,
        maxAttempts: 2,
        budget: new DeepSeekSearchFetchBudget(2, 0, 1_500),
       durableAttemptLedger: execution?.deepSeekDurableAttemptLedger,
        fetchImpl: async () => { throw new Error("controlled transport uncertainty"); },
      });
      await adapter.searchWeb({ input, start: new Date(failureClaim!.coverage_start), end: new Date(failureClaim!.coverage_end), queries: ["公开机器人融资"] });
      await execution?.onDeepSeekSearchFetchAudit?.({ ...infrastructure.deepSeekAudit(), usage: adapter.usageSnapshot() });
      throw new Error("controlled generation failure after search uncertainty");
    },
  });
  const failureStored = await query<{ status: string; error_code: string; usage: Record<string, unknown>; briefs: string }>(
    `SELECT status,error_code,usage,(SELECT COUNT(*)::text FROM intelligence_briefs WHERE run_id=$1) AS briefs
       FROM intelligence_runs WHERE id=$1`,
    [failureRun.id],
  );
  assert.equal(failureStored[0].status, "blocked");
  assert.equal(failureStored[0].error_code, "provider_call_uncertain");
  assert.equal(failureStored[0].briefs, "0");
  const failureAudit = assertSafeAudit(failureStored[0].usage.deepseekSearchFetch);
  assert.equal(failureAudit.usage.searchAttempts, 1);
  assert.equal(failureAudit.usage.searchUncertain, 1);
  assert.equal(failureAudit.usage.reservedUsdMicros, 750);
  const retry = await retryIntelligenceRun(userId, failureRun.id);
  assert.equal(retry, null, "用过单次外部费用授权的运行必须新建 run 并重新授权，不能直接重试");

  const scheduledTask = await task("计划运行默认禁止 DeepSeek 额外计费");
  const scheduledRun = await createIntelligenceRun({
    userId,
    taskId: scheduledTask,
    idempotencyKey: `scheduled:${scheduledTask}`,
    triggerType: "scheduled",
    scheduledFor: new Date(),
    authorizeDeepSeekSearch: true,
  });
  assert.deepEqual(scheduledRun.external_cost_authorization, {}, "计划运行即使调用方误传授权也必须失败关闭");
  await query("UPDATE intelligence_runs SET status='cancelled',finished_at=NOW() WHERE id=$1", [scheduledRun.id]);

  const oldestTask = await task("显式 worker 不得领取的旧 run");
  const oldestRun = await createIntelligenceRun({ userId, taskId: oldestTask, idempotencyKey: `oldest:${oldestTask}` });
  const explicitTask = await task("显式 DeepSeek worker run");
  const explicitRun = await createIntelligenceRun({
    userId,
    taskId: explicitTask,
    idempotencyKey: `explicit:${explicitTask}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  const processed = await processIntelligenceRunById(explicitRun.id, userId, "deepseek-explicit-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, input) => ({
      id: "",
      brief: emptyBrief(input.name, explicitRun.coverage_start, explicitRun.coverage_end),
    }),
  });
  assert.equal(processed, explicitRun.id);
  const exactRows = await query<{ id: string; status: string }>(
    "SELECT id,status FROM intelligence_runs WHERE id = ANY($1::uuid[]) ORDER BY id",
    [[oldestRun.id, explicitRun.id]],
  );
  assert.equal(exactRows.find((row) => row.id === oldestRun.id)?.status, "queued", "显式入口不得按最老队列领取");
  assert.equal(exactRows.find((row) => row.id === explicitRun.id)?.status, "partial");
  await query("UPDATE intelligence_runs SET status='cancelled',finished_at=NOW() WHERE id=$1", [oldestRun.id]);

  const diagnosticTask = await task("DeepSeek generation 脱敏失败阶段审计");
  const diagnosticRun = await createIntelligenceRun({
    userId,
    taskId: diagnosticTask,
    idempotencyKey: `diagnostic:${diagnosticTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const diagnosticWorker = "deepseek-diagnostic-worker";
  const diagnosticClaim = await claimNextIntelligenceRun(diagnosticWorker);
  assert.equal(diagnosticClaim?.id, diagnosticRun.id);
  await query(
    "UPDATE intelligence_runs SET provider_call_state='started',provider_call_started_at=NOW() WHERE id=$1 AND locked_by=$2",
    [diagnosticRun.id, diagnosticWorker],
  );
  const diagnosticProvider = createIntelligenceGenerationProvider(dummyCredentials, {
    requireDeepSeekBudget: true,
    deepSeekGenerationLedger: createDeepSeekGenerationRunAttemptLedger(diagnosticClaim!, diagnosticWorker),
    streamChatImpl: async function* () {
      yield "safe-partial";
      throw Object.assign(new Error("secret-response-fragment-must-not-persist"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(
    diagnosticProvider.generate!({ system: "offline", prompt: "public", phase: "diagnostic-stream" }),
    /must-not-persist/,
  );
  const diagnosticStored = await query<{ status: string; attempt_history: Array<Record<string, unknown>>; attempt_status: string }>(
    `SELECT r.status,r.attempt_history,a.status AS attempt_status
       FROM intelligence_runs r JOIN intelligence_run_external_attempts a ON a.run_id=r.id AND a.user_id=r.user_id
      WHERE r.id=$1 AND a.provider='deepseek' AND a.capability='generation'`,
    [diagnosticRun.id],
  );
  const safeDiagnostic = diagnosticStored[0].attempt_history.find((event) => event.event === "external-call-uncertain-diagnostic");
  assert.equal(diagnosticStored[0].attempt_status, "uncertain");
  assert.equal(safeDiagnostic?.stage, "stream");
  assert.equal(safeDiagnostic?.category, "connection");
  assert.equal(safeDiagnostic?.receivedOutput, true);
  assert.equal(safeDiagnostic?.outputChars, "safe-partial".length);
  assert.equal(JSON.stringify(diagnosticStored).includes("secret-response-fragment"), false, "脱敏诊断不得保存原始错误或响应");
  await query(
    `UPDATE intelligence_runs SET status='blocked',provider_call_state='uncertain',external_cost_authorization='{}'::jsonb,
            finished_at=NOW(),locked_at=NULL,locked_by=NULL,error_code='provider_call_uncertain',error_message_safe='受控离线失败'
      WHERE id=$1`,
    [diagnosticRun.id],
  );

  const truncatedTask = await task("DeepSeek generation 截断确定终态");
  const truncatedRun = await createIntelligenceRun({
    userId,
    taskId: truncatedTask,
    idempotencyKey: `truncated-completed:${truncatedTask}`,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
  });
  const truncatedClaim = await claimNextIntelligenceRun("deepseek-truncated-worker");
  assert.equal(truncatedClaim?.id, truncatedRun.id);
  await runClaimedIntelligenceRun(truncatedClaim!, "deepseek-truncated-worker", {
    getGenerationAccess: async () => access("custom"),
    generateBrief: async (_userId, _taskId, _input, _now, _slot, credentials, _runId, _defer, execution) => {
      const truncatedProvider = createIntelligenceGenerationProvider(credentials, {
        requireDeepSeekBudget: true,
        deepSeekGenerationLedger: execution?.deepSeekGenerationDurableLedger,
        streamChatImpl: async function* (request) {
          await request.onUsage?.({ inputTokens: 320, outputTokens: 64 });
          yield "bounded-truncated-output";
          throw new AICompletionTruncatedError();
        },
      });
      await truncatedProvider.generate!({ system: "offline", prompt: "public", phase: "controlled-truncated" });
      throw new Error("unreachable after controlled truncation");
    },
  });
  const truncatedStored = await query<{
    status: string; provider_call_state: string; error_code: string;
    external_cost_authorization: Record<string, unknown>;
    attempt_status: string; actual_input_tokens: number; actual_output_tokens: number;
  }>(
    `SELECT r.status,r.provider_call_state,r.error_code,r.external_cost_authorization,
            a.status AS attempt_status,a.actual_input_tokens,a.actual_output_tokens
       FROM intelligence_runs r JOIN intelligence_run_external_attempts a ON a.run_id=r.id AND a.user_id=r.user_id
      WHERE r.id=$1 AND a.provider='deepseek' AND a.capability='generation'`,
    [truncatedRun.id],
  );
  assert.equal(truncatedStored[0].status, "failed");
  assert.equal(truncatedStored[0].provider_call_state, "completed");
  assert.equal(truncatedStored[0].error_code, "generation_output_truncated");
  assert.deepEqual(truncatedStored[0].external_cost_authorization, {});
  assert.equal(truncatedStored[0].attempt_status, "completed");
  assert.equal(truncatedStored[0].actual_input_tokens, 320);
  assert.equal(truncatedStored[0].actual_output_tokens, 64);

  console.log("intelligence DeepSeek worker audit integration passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
