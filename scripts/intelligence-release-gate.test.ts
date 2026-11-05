import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const core = read("src/lib/intelligence.ts");
const web = read("src/lib/intelligenceWebSearch.ts");
const provider = read("src/lib/intelligenceProvider.ts");
const adapter = read("src/lib/intelligenceBailianAdapter.ts");
const freeQuota = read("src/lib/freeQuota.ts");
const generate = read("src/app/api/data-apps/intelligence-subscriptions/[id]/generate/route.ts");
const runs = read("src/lib/intelligenceRuns.ts");
const tasks = read("src/app/api/data-apps/intelligence-subscriptions/route.ts");
const taskMutation = read("src/app/api/data-apps/intelligence-subscriptions/[id]/route.ts");
const feedback = read("src/app/api/data-apps/intelligence-subscriptions/briefs/[briefId]/feedback/route.ts");
const generationBudget = read("src/lib/intelligenceDeepSeekGenerationBudget.ts");
const migration052 = read("db/migrations/052_intelligence_external_generation_budget.sql");
const migration053 = read("db/migrations/053_intelligence_pipeline_checkpoints.sql");
const explicitDeepSeekWorker = read("scripts/run-intelligence-deepseek-validation-once.ts");
const migration045 = read("db/migrations/045_intelligence_source_items.sql");
const migration046 = read("db/migrations/046_intelligence_brief_metadata.sql");
const briefReader = read("src/components/data-apps/IntelligenceBriefReader.tsx");

assert.match(tasks, /WHERE user_id = \$1/);
assert.match(generate, /createIntelligenceRun/);
assert.match(runs, /WHERE id = \$1 AND user_id = \$2/);
assert.match(taskMutation, /WHERE id=\$17 AND user_id=\$18/);
assert.match(feedback, /WHERE id=\$3 AND user_id=\$4/);
assert.ok(
  feedback.indexOf("SELECT id FROM intelligence_briefs WHERE id=$1 AND user_id=$2", feedback.indexOf("export async function POST"))
    < feedback.indexOf("await request.json()", feedback.indexOf("export async function POST")),
  "反馈写入必须先检查简报归属，再解析请求体",
);
assert.match(core, /runScheduledTasks/);
assert.match(core, /enqueueDueIntelligenceRuns\(now\)/);
assert.doesNotMatch(core, /generateBrief\(task\.user_id/);
assert.doesNotMatch(core, /SET is_active = false[\s\S]*runScheduledTasks/);
assert.match(runs, /\(dependencies\.generateBrief \?\? generateBrief\)\(/, "worker 必须通过可控依赖调用真实简报生成路径");
assert.match(runs, /run\.user_id/);
assert.match(runs, /authorizeDeepSeekSearchByok:\s*run\.external_cost_authorization\?\.deepSeekSearch === true/);
assert.match(runs, /onDeepSeekSearchFetchAudit:[\s\S]*recordDeepSeekSearchFetchAudit/);
assert.match(runs, /deepSeekDurableAttemptLedger:\s*createDeepSeekRunAttemptLedger/);
assert.match(runs, /markUnsettledDeepSeekAttemptsUncertainInTransaction\(client, blocked\.rows, now\)/);
assert.match(runs, /deepSeekGenerationDurableLedger:\s*createDeepSeekGenerationRunAttemptLedger\(run, workerKey\)/);
assert.match(runs, /requireDeepSeekGenerationBudget:\s*true/);
assert.match(runs, /deepSeekGeneration !== true/);
assert.match(runs, /deepSeekOnly && \(!deepSeekGeneration \|\| invalidDeepSeekEnvelope\)/);
assert.match(runs, /isOfficialDeepSeekBaseUrl\(generation\.credentials\.baseURL\)/);
assert.match(runs, /authorizedRunBudgetUsdMicros/);
assert.match(runs, /processIntelligenceRunById/);
assert.match(core, /retrievalProviderMode === "deepseek-only"[\s\S]*\? \[\]/);
assert.match(explicitDeepSeekWorker, /processIntelligenceRunById\(runId, userId, workerKey\)/);
assert.doesNotMatch(explicitDeepSeekWorker, /enqueueDueIntelligenceRuns|initializeScheduledTasks|processNextIntelligenceRun/);
assert.match(provider, /maxRetries:\s*0/);
assert.match(core, /maxAttempts:\s*1/);
assert.match(core, /positiveInteger\(env\.INTELLIGENCE_DEEPSEEK_SEARCH_MAX_REQUESTS, 2, 2\)/);
assert.match(runs, /return kind === "search" \? 2 : 0/);
assert.match(generationBudget, /DEEPSEEK_GENERATION_MAX_INPUT_TOKENS = 32_768/);
assert.match(generationBudget, /DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS = 8_192/);
assert.match(generationBudget, /DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS = 100_000/);
assert.match(migration052, /capability IN \('search', 'fetch', 'generation'\)/);
assert.match(migration053, /^\s*--[^\n]*\n(?:--[^\n]*\n)*\s*BEGIN;/, "checkpoint migration must begin an explicit transaction");
assert.match(migration053, /COMMIT;\s*$/, "checkpoint migration must commit explicitly");
assert.match(web, /WEB_SEARCH_SYSTEM_PROMPT/);
assert.match(web, /maxQueries: 4/);
assert.match(web, /maxCandidates: 80/);
assert.match(adapter, /assigned_site_list/);
assert.match(provider, /IntelligenceRetrievalOrchestrator/);
assert.match(provider, /nativeWebSearch/);
assert.match(adapter, /class BailianRetrievalProvider/);
assert.match(adapter, /BAILIAN_API_KEY/);
assert.doesNotMatch(core, /BAILIAN_API_KEY|DashScope|searchWithDashScopeHTTP|searchWebForIntelligence|qwen/);
assert.doesNotMatch(freeQuota, /BAILIAN_API_KEY/);
assert.match(migration045, /CREATE TABLE IF NOT EXISTS/);
assert.match(migration045, /CREATE INDEX IF NOT EXISTS/);
// 生产可能是 aivestor；其它环境可能是 aivestor_app；采集器为 zjjr_sync。
// 三者均须条件授权，角色缺失时跳过且不报错。
assert.match(
  migration045,
  /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'zjjr_sync'\)[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence_source_items TO zjjr_sync/,
);
assert.match(
  migration045,
  /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'aivestor_app'\)[\s\S]*GRANT SELECT ON intelligence_source_items TO aivestor_app/,
);
assert.match(
  migration045,
  /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'aivestor'\)[\s\S]*GRANT SELECT ON intelligence_source_items TO aivestor/,
);
assert.match(migration046, /ADD COLUMN IF NOT EXISTS metadata JSONB/);
assert.match(briefReader, /可能存在融资轮次口径差异/);
assert.match(briefReader, /核对这些来源是否指向同一事项/);
assert.doesNotMatch(briefReader, /来源冲突：同一主体在相近日期出现不同融资轮次/);
assert.doesNotMatch(core, /aivestor\.cn|aivestor\.com\.cn|中鉴智投/);
console.log("intelligence release gate tests passed");
