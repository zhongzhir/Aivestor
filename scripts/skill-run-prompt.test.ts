import assert from "node:assert/strict";
import { buildSkillRunPrompt } from "../src/lib/skillPrompt";

const prompt = buildSkillRunPrompt({
  promptTemplate: "请生成尽调清单。\n{project_info}",
  vars: {
    project_info: "项目：示例项目",
  },
  prependContext: "",
  extraInput: "针对销售的尽调",
});

const supplementIndex = prompt.indexOf("针对销售的尽调");
const templateIndex = prompt.indexOf("请生成尽调清单。");

assert.ok(supplementIndex >= 0, "final prompt should include the supplement");
assert.ok(
  supplementIndex < templateIndex,
  "supplement should appear before the skill template so it constrains the task"
);
assert.match(
  prompt,
  /必须优先遵循补充说明/,
  "final prompt should explicitly prioritize the supplement"
);

const withoutSupplement = buildSkillRunPrompt({
  promptTemplate: "请生成尽调清单。\n{project_info}",
  vars: {
    project_info: "项目：示例项目",
  },
  prependContext: "",
  extraInput: "   ",
});

assert.doesNotMatch(withoutSupplement, /补充说明/, "blank supplement is ignored");

console.log("skill-run-prompt tests passed");
