import assert from "node:assert/strict";
import { buildScreeningPrompt, parseScreeningResult } from "@/lib/screening";

const autonomous = buildScreeningPrompt("测试项目", null, "公司已有付费客户，但未披露收入。 ");
assert.match(autonomous.user, /投资人未填写筛选要求/);
assert.match(autonomous.user, /自主选择重要维度/);
assert.doesNotMatch(autonomous.user, /必须匹配用户偏好/);

const instructed = buildScreeningPrompt("测试项目", "只看已有收入的项目", "公司已有付费客户。 ");
assert.match(instructed.user, /只看已有收入的项目/);
assert.match(instructed.user, /匹配情况/);

const parsed = parseScreeningResult(JSON.stringify({
  disposition: "continue",
  summary: "已有初步客户验证，值得继续了解。",
  strengths: ["已有付费客户"],
  risks: ["收入规模未披露"],
  missing_information: ["收入及留存数据"],
  criteria_fit: null,
  evidence: [{ claim: "存在客户验证", quote: "公司已有付费客户" }],
  confidence: "medium",
}));
assert.equal(parsed.disposition, "continue");
assert.equal(parsed.evidence.length, 1);
assert.throws(() => parseScreeningResult('{"disposition":"ranked"}'), /有效初筛结论/);

const implementationSource = require("node:fs").readFileSync(
  require("node:path").join(process.cwd(), "src/lib/screening.ts"),
  "utf8"
);
assert.match(implementationSource, /status = 'pending'[\s\S]+status = 'processing'/);

console.log("batch-screening tests passed");
