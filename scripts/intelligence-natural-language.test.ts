import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNaturalLanguageFallback, planFromAI } from "@/lib/intelligenceNaturalLanguage";

const manual = parseNaturalLanguageFallback("我想关注芯片行业最近的变化");
assert.equal(manual.task.executionMode, "manual");
assert.equal(manual.task.isActive, true);
assert.equal(manual.questions.length, 0, "非关键字段缺失不应阻止创建");

const scheduled = parseNaturalLanguageFallback("每周一上午9点，整理最近一周国内AI赛事，重点北京、有奖金、适合我的项目参赛，同一赛事合并，不超过20条。", "America/Los_Angeles");
assert.equal(scheduled.task.executionMode, "scheduled");
assert.deepEqual(scheduled.task.scheduleConfig?.weekdays, [1]);
assert.equal(scheduled.task.scheduleConfig?.time, "09:00");
assert.equal(scheduled.task.scheduleConfig?.timezone, "America/Los_Angeles");
assert.equal(scheduled.task.lookbackPeriod.value, 7);
assert.equal(scheduled.task.maxItems, 20);
assert.ok(scheduled.task.regions.includes("北京"));
assert.ok(scheduled.task.includeRequirements.includes("有奖金"));
assert.match(scheduled.task.outputInstructions, /合并/);
assert.equal(scheduled.questions.length, 0);

const ambiguous = parseNaturalLanguageFallback("每周定时整理国内AI赛事");
assert.equal(ambiguous.task.executionMode, "manual", "没有明确时间不得自动启用定时生成");
assert.equal(ambiguous.questions.length, 1, "关键定时信息缺失时只提出一个追问");

const aiPlan = planFromAI("关注新能源汽车", JSON.stringify({
  task: { name: "新能源汽车跟踪", topics: ["新能源汽车"], maxItems: 12, executionMode: "manual" }, questions: [],
}));
assert.equal(aiPlan.task.name, "新能源汽车跟踪");
assert.equal(aiPlan.task.maxItems, 12);
assert.equal(aiPlan.task.executionMode, "manual");
assert.ok(Array.isArray(aiPlan.task.excludeRequirements));

const sanitized = planFromAI("关注AI赛事", JSON.stringify({ task: { name: "正常名称", topics: ["AI赛事"], maxItems: 999, unknownField: "ignore me", scheduleConfig: { frequency: "daily", time: "09:00" } }, questions: [] }), "Europe/London");
assert.equal(sanitized.task.maxItems, 50);
assert.equal("unknownField" in sanitized.task, false, "AI 未知字段不得进入任务配置");
assert.equal(sanitized.task.scheduleConfig?.timezone, "Europe/London");

const component = readFileSync(join(process.cwd(), "src/components/data-apps/IntelligenceSubscriptions.tsx"), "utf8");
for (const phrase of ["不展示默认新闻流", "未订制时不生成", "不主动推送", "信息负担", "泛新闻流", "本模块不支持", "本模块不包含"]) {
  assert.equal(component.includes(phrase), false, `内部文案未清理: ${phrase}`);
}
console.log("intelligence natural-language tests passed");
