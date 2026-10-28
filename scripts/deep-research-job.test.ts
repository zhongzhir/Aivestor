import assert from "assert";
import fs from "fs";
import { parseExternalResearchReport, resolveExternalFindingStatus } from "../src/lib/deepResearchExternal";
import { buildDueDiligenceTasks } from "../src/lib/deepResearchTasks";
import { isDeepResearchBetaWhitelisted } from "../src/lib/deepResearchAccess";

const allowed = new Set(["https://gov.example.cn/company/1", "https://media.example.com/a"]);
const parsed = parseExternalResearchReport(
  JSON.stringify({
    summary: "完成主体与客户线索核验",
    findings: [
      {
        id: "E1",
        topic: "主体",
        claim: "公司已登记成立",
        status: "confirmed",
        sourceUrls: ["https://gov.example.cn/company/1", "https://unknown.example/x"],
        publishedAt: "2026-10-20",
        evidenceNote: "官方主体登记",
        investmentImpact: "确认交易主体",
      },
      {
        id: "E2",
        topic: "客户",
        claim: "客户回款仍待确认",
        status: "reported",
        sourceUrls: [],
        publishedAt: null,
        evidenceNote: "无正文证据",
        investmentImpact: "影响收入质量",
      },
    ],
    searchedAreas: ["主体", "客户"],
    unresolvedGaps: ["客户回款凭证"],
    confidence: "medium",
  }),
  allowed
);
assert.deepEqual(parsed.findings[0].sourceUrls, ["https://gov.example.cn/company/1"]);
assert.equal(parsed.findings[1].status, "gap");
assert.equal(resolveExternalFindingStatus("confirmed", [{ domain: "gov.cn", sourceTier: "S" }]), "confirmed");
assert.equal(resolveExternalFindingStatus("confirmed", [{ domain: "media.example", sourceTier: "B" }]), "reported");
assert.equal(resolveExternalFindingStatus("confirmed", [
  { domain: "one.example", sourceTier: "B" },
  { domain: "two.example", sourceTier: "B" },
]), "confirmed");
assert.equal(resolveExternalFindingStatus("reported", [
  { domain: "gov.cn", sourceTier: "S" },
  { domain: "exchange.cn", sourceTier: "S" },
]), "reported");
assert.equal(resolveExternalFindingStatus("confirmed", []), "gap");
assert.equal(isDeepResearchBetaWhitelisted("user-1", "user-1,user-2"), true);
assert.equal(isDeepResearchBetaWhitelisted("user-3", "user-1,user-2"), false);
assert.equal(isDeepResearchBetaWhitelisted("user-3", "*"), true);

const tasks = buildDueDiligenceTasks(
  [
    {
      id: "C1",
      claim: "收入真实性待核验",
      status: "gap",
      citations: [],
      investmentImpact: "影响估值",
      verificationAction: "取得合同、发票和回款流水",
      priority: "P0",
    },
  ],
  {
    summary: parsed.summary,
    findings: parsed.findings,
    sources: [],
    searchedAreas: parsed.searchedAreas,
    unresolvedGaps: parsed.unresolvedGaps,
    confidence: parsed.confidence,
    telemetry: {},
  }
);
assert.equal(tasks.length, 2);
assert.equal(tasks[0].priority, "P0");
assert.match(tasks[1].evidenceItemId, /^EXT-GAP-/);

const migration = fs.readFileSync("db/migrations/050_deep_research_jobs.sql", "utf8");
assert.match(migration, /uq_deep_research_jobs_active_project/);
assert.match(migration, /status IN \('queued', 'running'\)/);
assert.match(migration, /UNIQUE \(job_id, evidence_item_id\)/);

const worker = fs.readFileSync("src/lib/deepResearchJobs.ts", "utf8");
assert.match(worker, /FOR UPDATE SKIP LOCKED/);
assert.match(worker, /locked_at < NOW\(\) - INTERVAL '20 minutes'/);
assert.match(worker, /attempt_count < max_attempts/);
assert.match(worker, /if \(reportId\)/);
assert.match(worker, /SET phase = 'task_creation'[\s\S]*report_id = \$1/);

const packageJson = fs.readFileSync("package.json", "utf8");
assert.match(packageJson, /ts-node\/register\/transpile-only[^"]*run-deep-research-worker\.ts --loop/);

const externalResearch = fs.readFileSync("src/lib/deepResearchExternal.ts", "utf8");
assert.match(externalResearch, /retrieval-first-fallback/);
assert.match(externalResearch, /resolveExternalFindingStatus/);

const refineRoute = fs.readFileSync("src/app/api/reports/[id]/refine/route.ts", "utf8");
assert.match(refineRoute, /result->'externalResearch'/);
assert.match(refineRoute, /`E\$\{index \+ 1\}`/);

console.log("deep research job tests passed");
