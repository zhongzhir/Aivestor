/// <reference path="../src/types/next-auth.d.ts" />
// Run only against a disposable local database; no production data or AI calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/lib/db";
import { normalizeResearchDraft } from "../src/lib/projectResearch";

if (process.env.RESEARCH_TEST_DATABASE !== "disposable") throw new Error("Use a disposable test database");
const uid = randomUUID(), otherUid = randomUUID(), projectId = randomUUID(), otherProject = randomUUID(), conversationId = randomUUID();
let sessionUser: string | null = uid;
function mock(name: string, exports: object) {
  const id = require.resolve(`../src/lib/${name}`);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}
mock("auth", { getSession: async () => sessionUser ? { user: { id: sessionUser } } : null });
mock("orgAuth", { getOrgContext: async () => null });
mock("deepResearchAccess", { canUseDeepResearchBeta: async () => false });
mock("report", { loadUserAICredentials: async () => ({ provider: "test", apiKey: "test" }), freeQuotaMetaFor: () => undefined });
const draft = normalizeResearchDraft({ summary: "增长假设需要核实", judgments: [
  { kind: "support", text: "客户续约有支持迹象（项目BP，第7页）" }, { kind: "concern", text: "收入预测尚无回款佐证" },
], questions: ["核实客户续约订单"], decision: "取得回款明细后再讨论推进条件" });
let generationCount = 0;
mock("ai", { streamChat: async function* () { generationCount++; yield JSON.stringify(draft); } });

async function main() {
  await pool.query(`
    CREATE TABLE projects (id uuid PRIMARY KEY, user_id uuid, org_id uuid, owner_id uuid, name text, process_stage text DEFAULT 'screening', judgment_points jsonb DEFAULT '[]', deleted_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE conversations (id uuid PRIMARY KEY, user_id uuid, project_id uuid REFERENCES projects, title text, messages jsonb);
    CREATE TABLE investment_judgments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES projects, user_id uuid, org_id uuid, stage text, content text NOT NULL, bull_case text, bear_case text, key_hypothesis text, metadata jsonb, updated_at timestamptz DEFAULT now());
    CREATE TABLE project_decision_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES projects, user_id uuid, org_id uuid, stage text, event_type text, status text, title text, note text);
    CREATE TABLE knowledge_base_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, project_id uuid REFERENCES projects, content text, source_type text, entry_type text, structured_data jsonb, review_status text, tags jsonb, metadata jsonb, embedding text, embedding_model text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  `);
  await pool.query("INSERT INTO projects (id,user_id,name,judgment_points) VALUES ($1,$2,'测试项目',$3),($4,$5,'他人项目','[]')", [projectId,uid,JSON.stringify(["原有手工判断"]),otherProject,otherUid]);
  const messages = [{ role: "user", content: "核实增长假设" }, { role: "assistant", content: "需要确认客户续约[1]", sources: [{ title: "项目BP", locator: "第7页", source_type: "project_document", content: "续约意向并非已签订单" }] }];
  await pool.query("INSERT INTO conversations VALUES ($1,$2,$3,'增长研究',$4)", [conversationId,uid,projectId,JSON.stringify(messages)]);
  const { conversationRevision, projectResearchContext } = require("../src/lib/projectResearchStore");
  const route = require("../src/app/api/conversations/[id]/project-research/route");
  const taskRoute = require("../src/app/api/projects/[id]/deep-research/tasks/route");
  const pendingRoute = require("../src/app/api/projects/[id]/pending-questions/route");
  const request = (body?: unknown) => new Request("http://localhost/test", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const params = { params: { id: conversationId } };
  const revision = conversationRevision({ project_id: projectId, messages });
  assert.equal((await (await route.GET(request(), params)).json()).current, false);
  const preview = await (await route.POST(request(), params)).json();
  assert.deepEqual(preview.draft, draft);
  assert.equal((await pool.query("SELECT * FROM investment_judgments")).rowCount, 0, "preview cannot write to SOP");
  const put = () => route.PUT(request({ revision, draft, project_id: otherProject }), params);
  const saves = await Promise.all([put(), put()]);
  const saveResults = [];
  for (const res of saves) { const body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body)); saveResults.push(body); }
  assert.equal(saveResults.filter((result) => result.unchanged).length, 1, "retrying the same snapshot is a no-op");
  assert.equal((await pool.query("SELECT * FROM investment_judgments")).rowCount, 1, "concurrent retries create one judgment");
  assert.equal((await pool.query("SELECT * FROM project_decision_events")).rowCount, 1);
  assert.equal((await pool.query("SELECT * FROM knowledge_base_entries")).rowCount, 1);
  let entry = (await pool.query("SELECT * FROM knowledge_base_entries")).rows[0];
  assert.equal(entry.project_id, projectId, "ignore client project override");
  assert.equal(entry.metadata.sources[0].locator, "第7页");
  let project = (await pool.query("SELECT * FROM projects WHERE id=$1", [projectId])).rows[0];
  assert.equal(project.process_stage, "screening");
  assert.equal(project.judgment_points[0], "原有手工判断");
  assert.equal((await pool.query("SELECT status FROM project_decision_events")).rows[0].status, "draft");
  assert.equal((await (await route.GET(request(), params)).json()).current, true);
  await route.POST(request(), params);
  assert.equal(generationCount, 1, "reopening current results avoids another generation");
  const taskParams = { params: { id: projectId } };
  let tasks = (await (await taskRoute.GET(request(), taskParams)).json()).tasks;
  assert.equal(tasks.length, 1, "conversation tasks available without deep research beta");
  assert.equal((await taskRoute.PATCH(request({ taskId: tasks[0].id, status: "done" }), taskParams)).status, 200);
  assert.equal((await taskRoute.PATCH(request({ taskId: tasks[0].id, status: "nonsense" }), taskParams)).status, 422);
  assert.equal((await taskRoute.PATCH(request({ taskId: tasks[0].id, status: "open" }), { params: { id: otherProject } })).status, 404);
  messages.push({ role: "user", content: "增加核实回款安排" });
  await pool.query("UPDATE conversations SET messages=$1 WHERE id=$2", [JSON.stringify(messages),conversationId]);
  assert.equal((await put()).status, 409, "reject an out-of-date preview");
  const nextDraft = { ...draft, questions: [...draft.questions, "核实回款安排"] };
  const nextRevision = conversationRevision({ project_id: projectId, messages });
  assert.equal((await route.PUT(request({ revision: nextRevision, draft: nextDraft }), params)).status, 200);
  tasks = (await (await taskRoute.GET(request(), taskParams)).json()).tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((task: any) => task.title === draft.questions[0]).status, "done");
  assert.deepEqual((await (await pendingRoute.GET(request(), taskParams)).json()).questions, ["核实回款安排"], "archive must not show completed questions as unresolved");
  const context = await projectResearchContext(projectId);
  assert.match(context, /增长假设需要核实/);
  assert.match(context, /第7页/);
  assert.match(context, /并非已签订单/);
  assert.match(context, /用户标记已完成/);
  assert.equal(await projectResearchContext(otherProject), "");
  // A formally recorded decision must never be overwritten by a later chat update.
  await pool.query("UPDATE project_decision_events SET status='approved',note='正式决议保持不变'");
  await route.PUT(request({ revision: nextRevision, draft: { ...nextDraft, decision: "继续核实，建议暂缓" } }), params);
  assert.equal((await pool.query("SELECT note FROM project_decision_events WHERE status='approved'")).rows[0].note, "正式决议保持不变");
  assert.equal((await pool.query("SELECT * FROM project_decision_events WHERE status='draft'")).rowCount, 1);
  // Force the last write to fail, then verify the transaction rolls back prior SOP writes.
  await pool.query("ALTER TABLE knowledge_base_entries ADD CONSTRAINT reject_test CHECK (content NOT LIKE '%ROLLBACK_TEST%')");
  const beforePoints = JSON.stringify((await pool.query("SELECT judgment_points FROM projects WHERE id=$1", [projectId])).rows[0].judgment_points);
  const failed = await route.PUT(request({ revision: nextRevision, draft: { ...nextDraft, summary: "ROLLBACK_TEST", judgments: [{ kind: "concern", text: "不得残留的判断" }] } }), params);
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify((await pool.query("SELECT judgment_points FROM projects WHERE id=$1", [projectId])).rows[0].judgment_points), beforePoints);
  sessionUser = otherUid;
  assert.equal((await route.PUT(request({ revision: nextRevision, draft }), params)).status, 404);
  sessionUser = null;
  assert.equal((await route.GET(request(), params)).status, 401);
  console.log("project research SOP integration: preview, real transactions, concurrent idempotency, permissions, project isolation, preserved sources, completed tasks, unchanged stage, decision draft safety and rollback passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
