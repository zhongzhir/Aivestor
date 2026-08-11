import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatInvestorResearchContext } from "@/lib/intelligenceInvestorContext";
const a = formatInvestorResearchContext({ profile: "## 关于这位投资人\n关注赛道：创新药", projects: [{ id: "a", name: "甲项目", company_name: "甲公司", industry: "创新药", process_stage: "尽调", judgment_points: ["海外授权能力"] }], judgments: new Map([["a", [{ project_id: "a", bull_case: "海外BD", bear_case: "付款条款", outcome: null, created_at: "2026-08-01" }]]]), knowledge: ["创新药交易结构关注首付款和里程碑"] });
const b = formatInvestorResearchContext({ profile: "## 关于这位投资人\n关注赛道：商业航天", projects: [], judgments: new Map(), knowledge: [] });
assert.match(a, /甲项目/); assert.match(a, /海外BD/); assert.notEqual(a, b); assert.match(a, /不得捏造项目关联/); assert.match(b, /画像的市场信号仍应保留/);

const source = readFileSync(resolve(__dirname, "../src/lib/intelligenceInvestorContext.ts"), "utf8");
assert.match(source, /buildAccessScope\(userId\)/, "investor context must derive a scope from the requesting user");
assert.match(source, /scopedProjectWhere\(scope, 1/, "visible projects must be constrained by the access scope");
assert.match(source, /AND user_id = \$2/, "project judgments must remain bound to the requesting user");
console.log("intelligence investor relevance tests passed");
