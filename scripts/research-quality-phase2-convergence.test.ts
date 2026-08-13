import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agent = readFileSync("src/lib/intelligenceResearchAgent.ts", "utf8");
const ai = readFileSync("src/lib/ai.ts", "utf8");
const provider = readFileSync("src/lib/intelligenceProvider.ts", "utf8");

assert.equal(/forced_finalization/.test(agent), false, "产品 Agent 主链不得保留 forced_finalization");
assert.equal(/AgentFinalOutput|safeAgentFinal|isAgentFinalOutput/.test(agent), false, "产品 Agent 主链不得依赖终稿 Findings schema");
assert.equal((agent.match(/agentic-integrated-review-and-synthesis/g) || []).length, 1, "最终集成模型调用只能有一次");
assert.match(agent, /sourceIdForUrl/);
assert.match(agent, /supportingEvidence\[\{sourceId/);
assert.match(agent, /evidenceCutoffAt = startedAt \+ 300_000/);
assert.match(agent, /integrationDeadlineAt = startedAt \+ 450_000/);
assert.match(agent, /Math\.min\(600_000/);
assert.match(agent, /integrationAbortController/);
assert.match(agent, /research_total_timeout:integrated_review_and_synthesis/);
assert.match(agent, /ResearchQualityDiagnostics/);
assert.match(ai, /signal\?: AbortSignal/);
assert.match(ai, /linkedAbortController/);
assert.match(ai, /client\.chat\.completions\.create\([\s\S]*signal: controller\.signal/);
assert.match(provider, /signal\?: AbortSignal/);

console.log("research quality phase2 convergence tests passed");
