/// <reference path="../src/types/next-auth.d.ts" />
import assert from "node:assert/strict";
import { researchQuery, researchHistory, digestSources, relevance, researchTerms } from "../src/lib/conversationResearch";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const source = { id: "chunk-a", title: "项目A BP", locator: "第7页", source_type: "project_document", content: "项目A的营收增长假设为30%，尚未取得审计材料。" };
const previous = [{ role: "user" as const, content: "营收增长假设是否合理？" }, { role: "assistant" as const, content: "需要核验客户续约情况。" }];
assert.match(researchQuery("依据呢", previous, "项目A"), /项目A[\s\S]*营收增长[\s\S]*依据呢/);
assert.ok(relevance(source.content, researchTerms("营收增长假设")) > relevance("员工宿舍", researchTerms("营收增长假设")));
const bounded = researchHistory(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `${i}:` + "研究".repeat(400) })), 4000);
assert.equal(bounded[0].role, "user");
assert.ok(bounded.reduce((n, item) => n + item.content.length, 0) <= 4000);
assert.match(bounded.at(-1)!.content, /^39:/);
assert.equal(digestSources([{ ...previous[1], sources: [source, source] }]).length, 1);

function mock(name: string, exports: object) {
  const id = require.resolve(`../src/lib/${name}`);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}

let user: { id: string } | null = { id: "user-a" };
let analyst = false;
let denied = false;
let noChunks = false;
let failGeneration = false;
let concurrentUpdate = false;
let persisted: any[] = [];
let prompt = "";
let writes = 0;
let linkedProject: string | null = projectId;
let entryProject: unknown;
let entryMetadata: any;
const queries: Array<{ sql: string; params: any[] }> = [];

mock("auth", { getSession: async () => user ? { user } : null });
mock("orgAuth", { getOrgContext: async () => analyst ? { orgId: "org-a", role: "analyst" } : null, hasCapability: async () => true });
mock("embedding", { generateEmbedding: async () => null });
mock("user-profile", { getUserProfile: async () => null, formatProfileForPrompt: () => "", injectProfile: async (_user: string, system: string) => system });
mock("report", { loadUserAICredentials: async () => ({ provider: "test", apiKey: "local-test" }), freeQuotaMetaFor: () => undefined });
mock("autoDigest", { shouldAutoDigest: () => false });
mock("ai", { streamChat: async function* (options: { system: string }) {
  if (options.system.includes("本轮可引用资料")) prompt = options.system;
  if (failGeneration) { yield "部分回答"; throw new Error("模拟上游中断"); }
  yield "增长假设仍需核验。[1](#source-1)";
} });
mock("db", { query: async (sql: string, params: any[] = []) => {
  queries.push({ sql, params });
  if (sql.startsWith("SELECT user_id, org_id, owner_id FROM projects")) {
    if (denied || params[0] === otherProjectId) return [];
    return [{ user_id: "user-a", org_id: analyst ? "org-a" : null, owner_id: "user-a" }];
  }
  if (sql.startsWith("SELECT name, stage, status, industry")) return [{ name: "项目A", stage: "A轮", status: "evaluating", industry: "软件" }];
  if (sql.startsWith("SELECT id, filename, parse_status")) return [{ id: "doc-a", filename: "项目A BP", parse_status: "done" }];
  if (sql.includes("FROM investment_judgments")) return [];
  if (sql.includes("FROM reports WHERE")) {
    assert.equal(params[0], projectId);
    if (analyst) { assert.equal(params[1], true, "analyst must exclude committee reports"); assert.match(sql, /kind <> 'committee'/); }
    return [];
  }
  if (sql.includes("FROM document_chunks dc")) {
    assert.equal(params[0], projectId, "document search must be scoped to the selected project");
    assert.match(sql, /d.project_id = \$1/);
    return noChunks ? [] : [{ id: source.id, document_id: "doc-a", filename: source.title, content: source.content, metadata: { label: source.locator } }];
  }
  if (sql.includes("LEFT(extracted_text")) return [{ id: "doc-a", filename: "项目A BP", extracted_text: "", source_map: [{ locator: "page:7", locatorType: "page", label: "第7页", text: source.content }] }];
  if (sql.includes("FROM knowledge_base_entries")) return [];
  if (sql.startsWith("SELECT id, title, project_id, messages, summary")) return [{ id: conversationId, title: "已有研究", project_id: linkedProject, messages: persisted, summary: "此前讨论了增长假设" }];
  if (sql.startsWith("SELECT project_id, messages FROM conversations")) return [{ project_id: linkedProject, messages: persisted }];
  if (sql.includes("SELECT c.id, c.title, c.project_id")) return [{ id: conversationId, title: "已有研究", project_id: linkedProject, project_name: "项目A", messages: persisted }];
  if (sql.startsWith("UPDATE conversations SET messages")) {
    if (concurrentUpdate) return [];
    assert.deepEqual(JSON.parse(params[3]), persisted);
    assert.equal(params[4], linkedProject);
    persisted = JSON.parse(params[0]); writes++;
    return [{ id: conversationId }];
  }
  if (sql.startsWith("UPDATE conversations SET project_id")) { linkedProject = params[0]; writes++; return [{ id: conversationId }]; }
  if (sql.includes("INSERT INTO conversations")) { writes++; return [{ id: conversationId }]; }
  if (sql.includes("INSERT INTO knowledge_base_entries")) {
    writes++; entryProject = params[7]; entryMetadata = JSON.parse(params[4]); return [{ id: "saved-digest" }];
  }
  if (sql.startsWith("UPDATE conversations SET summary")) return [];
  if (sql.startsWith("UPDATE conversations SET title")) return [];
  throw new Error(`Unhandled test query: ${sql}`);
} });

async function main() {
  const { conversationProjectContext } = require("../src/lib/conversationProjectContext");
  const chat = require("../src/app/api/conversations/[id]/chat/route");
  const detail = require("../src/app/api/conversations/[id]/route");
  const list = require("../src/app/api/conversations/route");
  const digest = require("../src/app/api/conversations/[id]/digest/route");
  const params = { params: { id: conversationId } };
  const request = (body: unknown) => new Request("http://localhost/api/conversations/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  let context = await conversationProjectContext(projectId, "user-a", researchQuery("依据呢", previous));
  assert.equal(context.sources[0].locator, "第7页");
  noChunks = true;
  context = await conversationProjectContext(projectId, "user-a", "营收增长");
  assert.equal(context.sources[0].locator, "第7页", "legacy materials retain real page locators without embeddings");
  noChunks = false; analyst = true;
  await conversationProjectContext(projectId, "user-a", "增长");
  analyst = false;

  const response = await chat.POST(request({ message: "依据呢" }), params);
  const stream = await response.text();
  assert.match(stream, /\[DONE\]/);
  assert.match(prompt, /项目A[\s\S]*第7页[\s\S]*营收增长/);
  assert.match(prompt, /反方证据/);
  assert.equal(persisted[1].sources[0].locator, "第7页");
  const restored = await (await detail.GET(new Request("http://localhost"), params)).json();
  assert.deepEqual(restored.conversation.messages[1].sources, persisted[1].sources, "citations survive reopening");

  const beforeFailure = JSON.stringify(persisted);
  failGeneration = true;
  const failed = await (await chat.POST(request({ message: "再分析" }), params)).text();
  assert.match(failed, /模拟上游中断/);
  assert.equal(JSON.stringify(persisted), beforeFailure, "partial answers must not become completed history");
  failGeneration = false; concurrentUpdate = true;
  const conflict = await (await chat.POST(request({ message: "换个角度" }), params)).text();
  assert.match(conflict, /未能保存/);
  assert.equal(JSON.stringify(persisted), beforeFailure);
  concurrentUpdate = false;

  denied = true;
  const beforeDenied = writes;
  assert.equal((await list.POST(request({ project_id: projectId }))).status, 404);
  assert.equal((await detail.GET(new Request("http://localhost"), params)).status, 404);
  assert.equal((await chat.POST(request({ message: "增长" }), params)).status, 404);
  assert.equal(writes, beforeDenied, "revoked access must not create or modify discussions");
  denied = false;

  assert.equal((await detail.PATCH(request({ project_id: null }), params)).status, 409, "existing project history must not silently become another context");
  linkedProject = null;
  assert.equal((await detail.PATCH(request({ project_id: projectId }), params)).status, 200, "free discussions can be explicitly linked");

  const saved = await digest.PUT(request({ structured_data: { summary: "增长假设仍待核验", key_insights: [] }, project_id: otherProjectId, project_name: "伪造项目B" }), params);
  assert.equal(saved.status, 200);
  assert.equal(entryProject, projectId, "digest must use server-side association, not client-supplied project");
  assert.equal(entryMetadata.sources[0].locator, "第7页");

  user = null;
  assert.equal((await chat.POST(request({ message: "分析" }), params)).status, 401);
  console.log("conversation research: follow-ups, bounded history, lexical fallback, permissions, citations, failures, concurrency, association and digest tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
