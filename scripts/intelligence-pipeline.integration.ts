import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import type { ChatRequest } from "@/lib/ai";
import { pool, query } from "@/lib/db";
import type { EvidenceCandidate } from "@/lib/intelligenceEvidence";
import {
  claimIntelligenceRunById,
  claimNextIntelligenceRun,
  blockStaleUncertainProviderRuns,
  createIntelligencePipelineStore,
  createIntelligenceRun,
  retryIntelligenceRun,
  runClaimedIntelligenceRun,
} from "@/lib/intelligenceRuns";
import { runIntelligencePipeline } from "@/lib/intelligencePipeline";
import type { IntelligenceProvider, RetrievalRequest } from "@/lib/intelligenceProvider";
import type { GenerationAccess } from "@/lib/intelligenceGeneration";
import type { WebSearchItem } from "@/lib/intelligenceWebSearch";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const database = new URL(connectionString);
if (!(database.hostname === "127.0.0.1" && database.port === "55435" && database.pathname === "/aivestor_core_v2_test")) {
  throw new Error("pipeline integration refuses any database except the isolated core-v2 database");
}

const searchCrashChildMode = process.argv.includes("--crash-after-search-checkpoint");
const factsCrashChildMode = process.argv.includes("--crash-during-facts-stream");
const childMode = searchCrashChildMode || factsCrashChildMode;
let userA = process.env.INTELLIGENCE_PIPELINE_TEST_USER_A || randomUUID();
let userB = process.env.INTELLIGENCE_PIPELINE_TEST_USER_B || randomUUID();
let runId = process.env.INTELLIGENCE_PIPELINE_TEST_RUN_ID || "";
const workerOne = "pipeline-crash-worker";
const workerTwo = "pipeline-recovery-worker";
const factsCrashWorker = "pipeline-facts-stream-crash-worker";
const userAEmail = userA === "90000000-0000-4000-8000-000000000001"
  ? "pipeline-ui@example.test"
  : `pipeline-a-${userA}@example.test`;
const userATestPassword = "Pipeline-Worker-Local!";

const item: WebSearchItem = {
  title: "宇树科技完成 B2 轮融资",
  url: "https://example.com/unitree-b2",
  siteName: "受控公开来源",
  snippet: "公开报道显示宇树科技完成 B2 轮融资。",
  publishedAt: "2024-02-02T00:00:00.000Z",
  sourceTier: "A",
  domain: "example.com",
  query: "宇树科技 2024 融资",
  searchProviders: ["controlled-search"],
};

function childProvider(): IntelligenceProvider {
  return {
    id: "controlled",
    capabilities: { generation: false, nativeWebSearch: false },
  };
}

async function crashChild(): Promise<never> {
  if (!userA || !runId) throw new Error("crash child identifiers are required");
  const rows = await query<{ config_snapshot: import("@/lib/intelligence").IntelligenceTaskInput; coverage_start: string; coverage_end: string }>(
    "SELECT config_snapshot,coverage_start,coverage_end FROM intelligence_runs WHERE id=$1 AND user_id=$2",
    [runId, userA],
  );
  assert.ok(rows[0], "claimed run missing in crash child");
  await query(
    `UPDATE intelligence_runs SET provider_call_state='started',provider_call_started_at=NOW()
      WHERE id=$1 AND user_id=$2 AND status='running' AND locked_by=$3`,
    [runId, userA, workerOne],
  );
  const store = createIntelligencePipelineStore({ id: runId, user_id: userA }, workerOne);
  await runIntelligencePipeline(
    rows[0].config_snapshot,
    { start: new Date(rows[0].coverage_start), end: new Date(rows[0].coverage_end) },
    new Date("2026-11-04T00:00:00.000Z"),
    {
      store,
      generationProvider: childProvider(),
      retrieval: {
        async retrieve(request: RetrievalRequest) {
          await request.onBatch?.({ provider: "controlled-search", query: item.query, results: [item] });
          // Deliberately skip all finally/terminal-stage code. The parent verifies
          // that the next owner can resume from this exact durable checkpoint.
          process.exit(70);
        },
      },
    },
  );
  throw new Error("crash child unexpectedly returned");
}

function runCrashChild(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "scripts/intelligence-pipeline.integration.ts",
      "--crash-after-search-checkpoint",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        INTELLIGENCE_PIPELINE_TEST_USER_A: userA,
        INTELLIGENCE_PIPELINE_TEST_RUN_ID: runId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

async function crashDuringFactsStreamChild(): Promise<never> {
  if (!userA || !runId) throw new Error("facts crash child identifiers are required");
  const claimed = await claimIntelligenceRunById(runId, userA, factsCrashWorker);
  assert.equal(claimed?.id, runId, "facts crash child must exclusively claim its explicit run");
  const store = createIntelligencePipelineStore(claimed!, factsCrashWorker);
  const evidenceKey = "source:facts-stream-crash";
  await store.saveCheckpoint({
    stage: "retrieval",
    status: "completed",
    payload: {
      status: "success",
      providers: [{ provider: "controlled-search", attempted: true, succeeded: true, queryCount: 1, resultCount: 1, status: "success", coverageCapability: "coarse" }],
      results: [item],
      fetchedAt: new Date().toISOString(),
    },
    diagnostics: {},
  });
  await store.upsertEvidence([{
    itemKey: evidenceKey,
    url: `${item.url}?fixture=facts-stream-crash`,
    title: item.title,
    sourceName: item.siteName,
    sourceTier: item.sourceTier,
    retrievalProvider: "controlled-search",
    query: item.query,
    snippet: item.snippet,
    contentExcerpt: "宇树科技完成B2轮融资。",
    publishedAt: item.publishedAt,
    fetchedAt: new Date().toISOString(),
    evidenceStatus: "full",
    failureReason: null,
  }]);
  await store.saveCheckpoint({ stage: "evidence", status: "completed", payload: { selectedEvidenceIds: [evidenceKey] }, diagnostics: { full: 1 } });

  async function* crashAfterPersistedFact(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const prompt = String(request.messages[0]?.content || "");
    const boundEvidenceId = prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
    assert.equal(boundEvidenceId, evidenceKey);
    yield `{"facts":[${JSON.stringify({
      h: "宇树科技完成 B2 轮融资",
      s: "公开报道显示宇树科技完成 B2 轮融资。",
      a: "融资金额仍需核验。",
      d: null,
      t: "融资",
      e: ["宇树科技"],
      st: "confirmed",
      r: "high",
      rr: "直接对应融资主题",
      ids: [evidenceKey],
    })},`;
    // The provider has delivered one complete fact and the pipeline callback has
    // durably checkpointed it before the generator is advanced again. Hard exit
    // deliberately skips every catch/finally/settlement path.
    process.exit(72);
  }

  await runClaimedIntelligenceRun(claimed!, factsCrashWorker, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: { generationStreamChatImpl: crashAfterPersistedFact },
  });
  throw new Error("facts stream crash child unexpectedly returned");
}

function runFactsCrashChild(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "scripts/intelligence-pipeline.integration.ts",
      "--crash-during-facts-stream",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        INTELLIGENCE_PIPELINE_TEST_USER_A: userA,
        INTELLIGENCE_PIPELINE_TEST_RUN_ID: runId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

function deepSeekAccess(): GenerationAccess {
  return {
    source: "custom",
    credentials: {
      provider: "deepseek",
      apiKey: "offline-pipeline-fixture",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      usingFreeQuota: false,
    },
  };
}

async function* structuredGeneration(request: ChatRequest): AsyncGenerator<string, void, unknown> {
  const prompt = String(request.messages[0]?.content || "");
  const evidenceId = prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
  assert.ok(evidenceId, "recovery generation must reference persisted evidence");
  request.onUsage?.({ inputTokens: 200, outputTokens: 150 });
  yield JSON.stringify({
    overview: "已恢复并形成一项有来源的融资事实。",
    facts: [{
      headline: "宇树科技完成 B2 轮融资",
      summary: "公开报道显示宇树科技完成 B2 轮融资。",
      assessment: "该事件显示机器人赛道资本关注度。",
      eventDate: "2024-02-01",
      eventTimeText: null,
      eventType: "融资",
      entities: ["宇树科技"],
      status: "confirmed",
      relevance: "high",
      relevanceReason: "直接对应融资主题",
      evidenceIds: [evidenceId],
    }],
    unresolvedGaps: ["融资金额尚未在受控样本中披露"],
    confidence: "medium",
  });
}

function fixtureGeneration(bundle: (evidenceId: string) => Record<string, unknown>) {
  return async function* generate(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const prompt = String(request.messages[0]?.content || "");
    const evidenceId = prompt.match(/"evidenceId":"([^"]+)"/)?.[1];
    assert.ok(evidenceId, "fixture generation must reference persisted evidence");
    request.onUsage?.({ inputTokens: 200, outputTokens: 150 });
    yield JSON.stringify(bundle(evidenceId));
  };
}

async function createCheckpointedFixtureRun(taskId: string, key: string, contentExcerpt: string) {
  const created = await createIntelligenceRun({
    userId: userA,
    taskId,
    idempotencyKey: `pipeline-${key}:${randomUUID()}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  const owner = `pipeline-${key}-worker`;
  const claimed = await claimIntelligenceRunById(created.id, userA, owner);
  assert.equal(claimed?.id, created.id);
  const store = createIntelligencePipelineStore({ id: created.id, user_id: userA }, owner);
  const evidenceKey = `source:${key}`;
  await store.saveCheckpoint({
    stage: "retrieval",
    status: "completed",
    payload: {
      status: "success",
      providers: [{ provider: "controlled-search", attempted: true, succeeded: true, queryCount: 2, resultCount: 1, status: "success", coverageCapability: "coarse" }],
      results: [item],
      fetchedAt: new Date().toISOString(),
    },
    diagnostics: {},
  });
  await store.upsertEvidence([{
    itemKey: evidenceKey,
    url: `${item.url}?fixture=${key}`,
    title: item.title,
    sourceName: item.siteName,
    sourceTier: item.sourceTier,
    retrievalProvider: "controlled-search",
    query: item.query,
    snippet: item.snippet,
    contentExcerpt,
    publishedAt: item.publishedAt,
    fetchedAt: new Date().toISOString(),
    evidenceStatus: "full",
    failureReason: null,
  }]);
  await store.saveCheckpoint({ stage: "evidence", status: "completed", payload: { selectedEvidenceIds: [evidenceKey] }, diagnostics: { full: 1 } });
  return { run: claimed!, owner };
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    BAILIAN_API_KEY: "",
    TAVILY_API_KEY: "",
    INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED: "false",
  });

  if (!runId) {
    const userAPasswordHash = await bcrypt.hash(userATestPassword, 10);
    await query(
      `INSERT INTO users (id,email,name,password_hash,auth_provider)
       VALUES ($1,$2,'Pipeline Owner A',$5,'credentials'),($3,$4,'Pipeline Owner B','offline','credentials')
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash`,
      [userA, userAEmail, userB, `pipeline-b-${userB}@example.test`, userAPasswordHash],
    );
    const taskId = randomUUID();
    await query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,original_request,event_types,source_policy)
       VALUES ($1,$2,'机器人企业资本动态','["机器人"]'::jsonb,'["宇树科技"]'::jsonb,
               '["融资"]'::jsonb,'["中国"]'::jsonb,'["融资轮次","投资方"]'::jsonb,
               '[]'::jsonb,10,'{"kind":"custom","start":"2024-01-01T00:00:00.000Z","end":"2024-12-31T23:59:59.999Z"}'::jsonb,
               '引用可核验来源','manual',NULL,true,$3,'["融资"]'::jsonb,'{}'::jsonb)`,
      [taskId, userA, "收集宇树科技 2024 年融资动态，并区分事实和判断"],
    );
    const created = await createIntelligenceRun({
      userId: userA,
      taskId,
      idempotencyKey: `pipeline-hard-exit:${taskId}`,
      now: new Date("2024-12-31T23:59:59.999Z"),
      authorizeDeepSeekSearch: true,
      authorizeDeepSeekGeneration: true,
      maxExternalCostUsdMicros: 100_000,
      retrievalProviderMode: "deepseek-only",
    });
    runId = created.id;
    const claimed = await claimIntelligenceRunById(runId, userA, workerOne);
    assert.equal(claimed?.id, runId);
  }
  const crashed = await runCrashChild();
  assert.equal(crashed.code, 70, `expected deliberate hard exit, got ${crashed.code}: ${crashed.output}`);

  const afterCrash = await query<{ evidence: string; retrieval_status: string; run_status: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS evidence,
       COALESCE((SELECT status FROM intelligence_run_checkpoints c WHERE c.run_id=r.id AND c.stage='retrieval'),'missing') AS retrieval_status,
       r.status AS run_status
     FROM intelligence_runs r WHERE r.id=$1 AND r.user_id=$2`,
    [runId, userA],
  );
  assert.deepEqual(afterCrash[0], { evidence: "1", retrieval_status: "running", run_status: "running" });

  const foreignStore = createIntelligencePipelineStore({ id: runId, user_id: userB }, "foreign-worker");
  assert.equal(await foreignStore.loadCheckpoint("retrieval"), null);
  assert.deepEqual(await foreignStore.listEvidence(), []);
  await assert.rejects(
    foreignStore.saveCheckpoint({ stage: "brief", status: "failed", payload: {}, diagnostics: {} }),
    /RUN_LEASE_LOST/,
  );

  // This is the dedicated core-v2 fixture database. Keep unrelated UI fixtures
  // from being claimed by the recovery worker; the UI seed restores them later.
  await query(
    "UPDATE intelligence_runs SET status='cancelled',finished_at=NOW(),locked_by=NULL,locked_at=NULL WHERE id<>$1 AND status IN ('queued','running')",
    [runId],
  );
  await query("UPDATE intelligence_runs SET locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1 AND user_id=$2", [runId, userA]);
  const reclaimed = await claimNextIntelligenceRun(workerTwo);
  assert.equal(reclaimed?.id, runId);
  let evidenceCalls = 0;
  await runClaimedIntelligenceRun(reclaimed!, workerTwo, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: structuredGeneration,
      testEvidenceAcquirer: async <T extends EvidenceCandidate>(candidates: T[]) => {
        evidenceCalls += 1;
        return {
          candidates: candidates.map((candidate) => Object.assign(candidate, {
            content: "宇树科技于2024年2月1日完成B2轮融资。该信息来自受控公开报道。",
            evidenceStatus: "full" as const,
            evidencePublishedAt: "2024-02-02T00:00:00.000Z",
          })),
          stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 },
        };
      },
    },
  });
  assert.equal(evidenceCalls, 1);

  const final = await query<{
    status: string;
    item_count: number;
    original_request: string | null;
    evidence: string;
    checkpoints: string;
    retrieval_status: string;
    generated_at: string;
    coverage_end: string;
  }>(
    `SELECT r.status,b.item_count,t.original_request,b.generated_at,b.coverage_end,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS evidence,
            (SELECT COUNT(*)::text FROM intelligence_run_checkpoints c WHERE c.run_id=r.id AND c.user_id=r.user_id) AS checkpoints,
            (SELECT status FROM intelligence_run_checkpoints c WHERE c.run_id=r.id AND c.stage='retrieval') AS retrieval_status
       FROM intelligence_runs r
       JOIN intelligence_tasks t ON t.id=r.task_id AND t.user_id=r.user_id
       JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2`,
    [runId, userA],
  );
  assert.equal(final[0]?.status, "partial", "interrupted retrieval remains visibly partial even after a useful fact is recovered");
  assert.equal(Number(final[0]?.item_count), 1);
  assert.equal(final[0]?.original_request, "收集宇树科技 2024 年融资动态，并区分事实和判断");
  assert.ok(Number(final[0]?.evidence) >= 1, "search checkpoint evidence must survive atomic brief publication");
  assert.equal(Number(final[0]?.checkpoints), 5);
  assert.equal(final[0]?.retrieval_status, "partial");
  assert.ok(
    new Date(final[0]!.generated_at).getTime() > new Date(final[0]!.coverage_end).getTime(),
    "historic coverage end must not replace the actual brief generation time",
  );
  console.log("[PASS 1/7] hard-exit after Search checkpoint recovered without replay; evidence and five checkpoints persisted");

  const taskRow = await query<{ task_id: string }>("SELECT task_id FROM intelligence_runs WHERE id=$1 AND user_id=$2", [runId, userA]);
  const uncertainRun = await createIntelligenceRun({
    userId: userA,
    taskId: taskRow[0]!.task_id,
    idempotencyKey: `pipeline-facts-uncertain:${randomUUID()}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  const factsOwner = "pipeline-facts-crash-worker";
  assert.equal((await claimIntelligenceRunById(uncertainRun.id, userA, factsOwner))?.id, uncertainRun.id);
  const uncertainStore = createIntelligencePipelineStore({ id: uncertainRun.id, user_id: userA }, factsOwner);
  await uncertainStore.saveCheckpoint({ stage: "retrieval", status: "completed", payload: { status: "success", providers: [], results: [item] }, diagnostics: {} });
  await uncertainStore.upsertEvidence([{
    itemKey: "source:facts-uncertain",
    url: item.url,
    title: item.title,
    sourceName: item.siteName,
    sourceTier: item.sourceTier,
    retrievalProvider: "controlled-search",
    query: item.query,
    snippet: item.snippet,
    contentExcerpt: "宇树科技于2024年2月1日完成B2轮融资。",
    publishedAt: item.publishedAt,
    fetchedAt: new Date().toISOString(),
    evidenceStatus: "full",
    failureReason: null,
  }]);
  await uncertainStore.saveCheckpoint({ stage: "facts", status: "running", payload: {}, diagnostics: {} });
  await query(
    `UPDATE intelligence_runs SET provider_call_state='started',provider_call_started_at=NOW(),locked_at=NOW()-INTERVAL '21 minutes'
      WHERE id=$1 AND user_id=$2 AND locked_by=$3`,
    [uncertainRun.id, userA, factsOwner],
  );
  await blockStaleUncertainProviderRuns();
  const uncertainState = await query<{ status: string; provider_call_state: string; error_code: string }>(
    "SELECT status,provider_call_state,error_code FROM intelligence_runs WHERE id=$1 AND user_id=$2",
    [uncertainRun.id, userA],
  );
  assert.deepEqual(uncertainState[0], { status: "blocked", provider_call_state: "uncertain", error_code: "provider_call_uncertain" });
  console.log("[PASS 2/7] facts-stage lost lease remained blocked/uncertain and was not automatically replayed");

  const factsStreamRun = await createIntelligenceRun({
    userId: userA,
    taskId: taskRow[0]!.task_id,
    idempotencyKey: `pipeline-facts-stream-crash:${randomUUID()}`,
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: 100_000,
    retrievalProviderMode: "deepseek-only",
  });
  runId = factsStreamRun.id;
  const factsCrashed = await runFactsCrashChild();
  assert.equal(factsCrashed.code, 72, `expected facts-stream hard exit, got ${factsCrashed.code}: ${factsCrashed.output}`);
  const factsCrashState = await query<{
    status: string; provider_call_state: string; locked_by: string; checkpoint_status: string;
    accepted_items: number; automatic_replay_allowed: boolean; attempt_status: string;
  }>(
    `SELECT r.status,r.provider_call_state,r.locked_by,
            c.status AS checkpoint_status,
            COALESCE((c.diagnostics->>'acceptedItems')::int,0) AS accepted_items,
            COALESCE((c.diagnostics->>'automaticReplayAllowed')::boolean,false) AS automatic_replay_allowed,
            a.status AS attempt_status
       FROM intelligence_runs r
       JOIN intelligence_run_checkpoints c ON c.run_id=r.id AND c.user_id=r.user_id AND c.stage='facts'
       JOIN intelligence_run_external_attempts a ON a.run_id=r.id AND a.user_id=r.user_id
            AND a.provider='deepseek' AND a.capability='generation'
      WHERE r.id=$1 AND r.user_id=$2`,
    [runId, userA],
  );
  assert.deepEqual(factsCrashState[0], {
    status: "running",
    provider_call_state: "started",
    locked_by: factsCrashWorker,
    checkpoint_status: "running",
    accepted_items: 1,
    automatic_replay_allowed: false,
    attempt_status: "reserved",
  });
  await query("UPDATE intelligence_runs SET locked_at=NOW()-INTERVAL '21 minutes' WHERE id=$1 AND user_id=$2", [runId, userA]);
  await blockStaleUncertainProviderRuns();
  const factsBlocked = await query<{ status: string; provider_call_state: string; error_code: string; attempt_status: string; authorization: Record<string, unknown> }>(
    `SELECT r.status,r.provider_call_state,r.error_code,r.external_cost_authorization AS authorization,a.status AS attempt_status
       FROM intelligence_runs r JOIN intelligence_run_external_attempts a ON a.run_id=r.id AND a.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2 AND a.provider='deepseek' AND a.capability='generation'`,
    [runId, userA],
  );
  assert.deepEqual(factsBlocked[0], {
    status: "blocked",
    provider_call_state: "uncertain",
    error_code: "provider_call_uncertain",
    attempt_status: "uncertain",
    authorization: {},
  });
  assert.equal(await claimIntelligenceRunById(runId, userA, "forbidden-replay-worker"), null);
  assert.equal(await retryIntelligenceRun(userA, runId), null, "a killed facts stream with an external attempt must require a new run and fresh authorization");
  console.log("[PASS 2b/7] hard-killed production facts stream persisted its valid checkpoint, then blocked uncertain without replay");

  const { run: dateRun, owner: dateOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "subject-date-gate",
    "甲公司于2024年1月22日完成B2轮融资。宇树科技完成B2轮融资，但公开材料未披露事件日期。",
  );
  await runClaimedIntelligenceRun(dateRun, dateOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "宇树科技融资事项已确认。",
        facts: [{
          headline: "宇树科技于2024年1月22日完成 B2 轮融资",
          summary: "宇树科技于2024年1月22日完成 B2 轮融资。",
          assessment: "资本活跃度值得跟踪。",
          eventDate: "2024-01-22",
          eventTimeText: null,
          eventType: "融资",
          entities: ["宇树科技"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "直接对应主题",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "medium",
      })),
    },
  });
  const dateBrief = await query<{ item_count: number; important_facts: Array<Record<string, unknown>> }>(
    "SELECT item_count,important_facts FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [dateRun.id, userA],
  );
  assert.equal(dateBrief[0]?.item_count, 1);
  assert.equal(dateBrief[0]?.important_facts[0]?.eventDate, undefined, "a different company's date must not reach the stored brief");
  assert.doesNotMatch(JSON.stringify(dateBrief[0]?.important_facts[0]), /2024-01-22|1月22日/);
  console.log("[PASS 3/7] another company's precise date was removed from the stored target-company fact");

  const { run: absenceRun, owner: absenceOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "absence-gate",
    "甲公司于2024年1月22日完成B2轮融资。",
  );
  await runClaimedIntelligenceRun(absenceRun, absenceOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "本期未发生任何并购或融资。",
        facts: [{
          headline: "宇树科技完成 B2 轮融资",
          summary: "宇树科技完成 B2 轮融资。",
          assessment: "资本活跃度提升。",
          eventDate: null,
          eventTimeText: null,
          eventType: "融资",
          entities: ["宇树科技"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "直接对应主题",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "high",
      })),
    },
  });
  const absenceBrief = await query<{ item_count: number; metadata: Record<string, unknown> }>(
    "SELECT item_count,metadata FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [absenceRun.id, userA],
  );
  assert.equal(absenceBrief[0]?.item_count, 0);
  assert.match(String(absenceBrief[0]?.metadata.overview), /不代表市场上没有/);
  assert.doesNotMatch(String(absenceBrief[0]?.metadata.overview), /未发生任何/);
  console.log("[PASS 4/7] unrelated evidence and model absence claim became an insufficient-evidence brief");

  const englishTaskId = randomUUID();
  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,original_request,event_types,source_policy)
     VALUES ($1,$2,'Unitree financing','["robotics"]'::jsonb,'["Unitree Robotics"]'::jsonb,
             '["financing"]'::jsonb,'["China"]'::jsonb,'["round","investor role"]'::jsonb,
             '[]'::jsonb,10,'{"kind":"custom","start":"2024-01-01T00:00:00.000Z","end":"2024-12-31T23:59:59.999Z"}'::jsonb,
             'Cite verifiable sources','manual',NULL,true,$3,'["financing"]'::jsonb,'{}'::jsonb)`,
    [englishTaskId, userA, "Track Unitree Robotics financing and investor roles"],
  );
  const { run: attributeRun, owner: attributeOwner } = await createCheckpointedFixtureRun(
    englishTaskId,
    "attribute-gate",
    "Unitree Robotics raised 1亿美元 in Series B financing. Sequoia Capital participated in the financing.",
  );
  await runClaimedIntelligenceRun(attributeRun, attributeOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "All other investor participation was absent.",
        facts: [{
          headline: "Unitree Robotics raised $100 million in Series B financing; Sequoia Capital led the financing",
          summary: "Unitree Robotics raised USD 100m; Sequoia Capital was the lead investor.",
          assessment: "The financing is material for the company.",
          eventDate: null,
          eventTimeText: null,
          eventType: "financing",
          entities: ["Unitree Robotics", "Sequoia Capital"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "financing and investor participation",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "high",
      })),
    },
  });
  const attributeBrief = await query<{ item_count: number; important_facts: unknown[]; other_items: Array<Record<string, unknown>>; metadata: Record<string, unknown> }>(
    "SELECT item_count,important_facts,other_items,metadata FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [attributeRun.id, userA],
  );
  assert.equal(attributeBrief[0]?.important_facts.length, 0, "participation evidence must not become a lead-investor claim in the stored brief");
  assert.equal(attributeBrief[0]?.item_count, 1, "the source-backed financing action remains visible as a sparse clue");
  assert.equal(attributeBrief[0]?.other_items[0]?.isClue, true);
  assert.doesNotMatch(JSON.stringify(attributeBrief[0]), /lead investor|led the financing|All other investor participation was absent/i);

  const { run: equivalentUsdRun, owner: equivalentUsdOwner } = await createCheckpointedFixtureRun(
    englishTaskId,
    "equivalent-usd",
    "Unitree Robotics raised 1亿美元 in Series B financing. Sequoia Capital led the financing.",
  );
  await runClaimedIntelligenceRun(equivalentUsdRun, equivalentUsdOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "One source-backed financing event was identified.",
        facts: [{
          headline: "Unitree Robotics raised $100 million in Series B financing; Sequoia Capital was the lead investor",
          summary: "Unitree Robotics raised USD 100m and Sequoia Capital led the financing.",
          assessment: "The financing is material for the company.",
          eventDate: null,
          eventTimeText: null,
          eventType: "financing",
          entities: ["Unitree Robotics", "Sequoia Capital"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "financing and investor role",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "high",
      })),
    },
  });
  const equivalentUsdBrief = await query<{ item_count: number; important_facts: unknown[]; other_items: unknown[] }>(
    "SELECT item_count,important_facts,other_items FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [equivalentUsdRun.id, userA],
  );
  assert.equal(equivalentUsdBrief[0]?.item_count, 1, "1亿美元 and $100 million must remain one supported event through worker persistence");

  const { run: equivalentCnyRun, owner: equivalentCnyOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "equivalent-cny",
    "宇树科技完成人民币10亿B2轮融资，红杉资本领投。",
  );
  await runClaimedIntelligenceRun(equivalentCnyRun, equivalentCnyOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "识别到一项有来源的融资事件。",
        facts: [{
          headline: "宇树科技完成10亿元B2轮融资",
          summary: "宇树科技完成10亿元B2轮融资，红杉资本领投。",
          assessment: "融资事件与主题直接相关。",
          eventDate: null,
          eventTimeText: null,
          eventType: "融资",
          entities: ["宇树科技", "红杉资本"],
          status: "confirmed",
          relevance: "high",
          relevanceReason: "融资主题",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "high",
      })),
    },
  });
  const equivalentCnyBrief = await query<{ item_count: number }>(
    "SELECT item_count FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [equivalentCnyRun.id, userA],
  );
  assert.equal(equivalentCnyBrief[0]?.item_count, 1, "人民币10亿 and 10亿元 must remain one supported event through worker persistence");
  console.log("[PASS 5/7] worker persistence accepted equivalent CNY/USD amounts and rejected participant-to-lead role escalation");

  const { run: unknownRun, owner: unknownOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "unknown-action-clue",
    "宇树科技于2024年5月完成股权转让，受让方为乙公司。",
  );
  await runClaimedIntelligenceRun(unknownRun, unknownOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        overview: "宇树科技发生股权转让。",
        facts: [{
          headline: "宇树科技完成股权转让",
          summary: "宇树科技完成股权转让，受让方为乙公司。",
          assessment: "交易结构仍需后续核验。",
          eventDate: null,
          eventTimeText: "2024年5月",
          eventType: "股权转让",
          entities: ["宇树科技", "乙公司"],
          status: "confirmed",
          relevance: "medium",
          relevanceReason: "属于资本结构变化",
          evidenceIds: [evidenceId],
        }],
        unresolvedGaps: [],
        confidence: "medium",
      })),
    },
  });
  const unknownBrief = await query<{ item_count: number; important_facts: unknown[]; other_items: Array<Record<string, unknown>> }>(
    "SELECT item_count,important_facts,other_items FROM intelligence_briefs WHERE run_id=$1 AND user_id=$2",
    [unknownRun.id, userA],
  );
  assert.equal(unknownBrief[0]?.item_count, 1);
  assert.equal(unknownBrief[0]?.important_facts.length, 0);
  assert.equal(unknownBrief[0]?.other_items[0]?.isClue, true, "unclassified evidence-backed actions remain visible only as clues");
  console.log("[PASS 6/7] evidence-backed unclassified action persisted as a clue, not a confirmed fact");

  const { run: emptyModelClueRun, owner: emptyModelClueOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "legal-empty-model-clue",
    "宇树科技于2024年2月完成B2轮融资，融资金额和完整投资方仍待核验。",
  );
  await runClaimedIntelligenceRun(emptyModelClueRun, emptyModelClueOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration(() => ({ facts: [], g: ["结构化事项未完成"], c: "low" })),
    },
  });
  const emptyModelClue = await query<{
    item_count: number; clues: number; evidence_rows: string; unique_urls: string; fact_bindings: number;
  }>(
    `SELECT b.item_count,jsonb_array_length(b.other_items) AS clues,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS evidence_rows,
            (SELECT COUNT(DISTINCT e.canonical_url)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS unique_urls,
            COALESCE((SELECT MAX(jsonb_array_length(e.supports_fact_keys)) FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id),0) AS fact_bindings
       FROM intelligence_runs r JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2`,
    [emptyModelClueRun.id, userA],
  );
  assert.deepEqual(emptyModelClue[0], { item_count: 1, clues: 1, evidence_rows: "1", unique_urls: "1", fact_bindings: 1 });

  const { run: verifiedZeroRun, owner: verifiedZeroOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "legal-empty-unrelated",
    "甲公司于2024年2月完成B2轮融资，与宇树科技无关。",
  );
  await runClaimedIntelligenceRun(verifiedZeroRun, verifiedZeroOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration(() => ({ facts: [], g: ["未形成任务相关事项"], c: "low" })),
    },
  });
  const verifiedZero = await query<{
    item_count: number; evidence_rows: string; unique_urls: string; fact_bindings: number; metadata: Record<string, unknown>;
  }>(
    `SELECT b.item_count,b.metadata,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS evidence_rows,
            (SELECT COUNT(DISTINCT e.canonical_url)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS unique_urls,
            COALESCE((SELECT MAX(jsonb_array_length(e.supports_fact_keys)) FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id),0) AS fact_bindings
       FROM intelligence_runs r JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2`,
    [verifiedZeroRun.id, userA],
  );
  assert.equal(verifiedZero[0]?.item_count, 0);
  assert.equal(verifiedZero[0]?.evidence_rows, "1");
  assert.equal(verifiedZero[0]?.unique_urls, "1");
  assert.equal(verifiedZero[0]?.fact_bindings, 0);
  assert.match(String(verifiedZero[0]?.metadata.overview), /不代表市场上没有/);
  console.log("[PASS 7/9] legal empty model output preserved an evidence-backed clue; source row stayed unique");
  console.log("[PASS 8/9] task-unrelated evidence stayed a zero-item partial result with one unique source row");

  const { run: sameSourceEventsRun, owner: sameSourceEventsOwner } = await createCheckpointedFixtureRun(
    taskRow[0]!.task_id,
    "same-source-distinct-events",
    "宇树科技于2024年2月完成B2轮融资。2024年9月，宇树科技又完成C轮融资。",
  );
  await runClaimedIntelligenceRun(sameSourceEventsRun, sameSourceEventsOwner, {
    getGenerationAccess: async () => deepSeekAccess(),
    testOnlyInfrastructure: {
      generationStreamChatImpl: fixtureGeneration((evidenceId) => ({
        facts: [
          {
            p: "宇树科技", h: "宇树科技完成B2轮融资", s: "宇树科技完成B2轮融资。", a: "", d: null, t: "融资", e: ["宇树科技"],
            x: [{ k: "round", v: "B2轮", n: "宇树科技", o: null, ids: [evidenceId] }], st: "confirmed", r: "high", rr: "融资事项", ids: [evidenceId],
          },
          {
            p: "宇树科技", h: "宇树科技完成C轮融资", s: "宇树科技完成C轮融资。", a: "", d: null, t: "融资", e: ["宇树科技"],
            x: [{ k: "round", v: "C轮", n: "宇树科技", o: null, ids: [evidenceId] }], st: "confirmed", r: "high", rr: "融资事项", ids: [evidenceId],
          },
        ],
        g: [],
        c: "high",
      })),
    },
  });
  const sameSourceEvents = await query<{
    item_count: number; important_facts: Array<Record<string, unknown>>; evidence_rows: string; unique_urls: string; fact_bindings: number;
  }>(
    `SELECT b.item_count,b.important_facts,
            (SELECT COUNT(*)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS evidence_rows,
            (SELECT COUNT(DISTINCT e.canonical_url)::text FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id) AS unique_urls,
            COALESCE((SELECT MAX(jsonb_array_length(e.supports_fact_keys)) FROM intelligence_run_evidence e WHERE e.run_id=r.id AND e.user_id=r.user_id),0) AS fact_bindings
       FROM intelligence_runs r JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2`,
    [sameSourceEventsRun.id, userA],
  );
  assert.equal(sameSourceEvents[0]?.item_count, 2, "same source must retain its two distinct financing rounds");
  assert.equal(sameSourceEvents[0]?.evidence_rows, "1");
  assert.equal(sameSourceEvents[0]?.unique_urls, "1");
  assert.equal(sameSourceEvents[0]?.fact_bindings, 2);
  assert.match(sameSourceEvents[0]?.important_facts.map((fact) => fact.title).join(" | ") || "", /B2轮/);
  assert.match(sameSourceEvents[0]?.important_facts.map((fact) => fact.title).join(" | ") || "", /C轮/);
  console.log("[PASS 9/10] one canonical source row retained two distinct event bindings without merging the rounds");

  console.log("intelligence pipeline isolated PostgreSQL recovery: 10 stories passed");
  console.log(JSON.stringify({
    e2eEmail: userAEmail,
    e2eTaskId: taskRow[0]!.task_id,
  }));
}

if (childMode) {
  (factsCrashChildMode ? crashDuringFactsStreamChild() : crashChild()).catch((error) => {
    console.error(error);
    process.exit(71);
  });
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(async () => {
    await pool.end().catch(() => {});
  });
}
