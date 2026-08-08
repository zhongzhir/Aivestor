import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const core = read("src/lib/intelligence.ts");
const web = read("src/lib/intelligenceWebSearch.ts");
const generate = read("src/app/api/data-apps/intelligence-subscriptions/[id]/generate/route.ts");
const tasks = read("src/app/api/data-apps/intelligence-subscriptions/route.ts");
const taskMutation = read("src/app/api/data-apps/intelligence-subscriptions/[id]/route.ts");
const feedback = read("src/app/api/data-apps/intelligence-subscriptions/briefs/[briefId]/feedback/route.ts");
const migration045 = read("db/migrations/045_intelligence_source_items.sql");
const migration046 = read("db/migrations/046_intelligence_brief_metadata.sql");

assert.match(tasks, /WHERE user_id = \$1/);
assert.match(generate, /id=\$1 AND user_id=\$2/);
assert.match(taskMutation, /WHERE id=\$14 AND user_id=\$15/);
assert.match(feedback, /WHERE id=\$3 AND user_id=\$4/);
assert.match(core, /runScheduledTasks/);
assert.match(core, /generateBrief\(task\.user_id/);
assert.match(generate, /generateBrief\(guard\.access\.userId/);
assert.match(web, /WEB_SEARCH_SYSTEM_PROMPT/);
assert.match(web, /maxQueries: 4/);
assert.match(web, /maxCandidates: 80/);
assert.match(web, /isDashScopeCredential/);
assert.match(web, /assigned_site_list/);
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
assert.doesNotMatch(core, /aivestor\.cn|aivestor\.com\.cn|中鉴智投/);
console.log("intelligence release gate tests passed");
