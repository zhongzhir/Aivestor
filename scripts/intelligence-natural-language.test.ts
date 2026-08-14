import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNaturalLanguageFallback, parseNaturalLanguageFallbackAt, planFromAI, planFromAIOrFallback } from "@/lib/intelligenceNaturalLanguage";

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
assert.equal(sanitized.task.scheduleConfig, null, "用户未提出周期意图时不得采纳 AI 虚构的调度配置");

const now = new Date("2026-08-09T06:00:00.000Z");
const oneOffDescription = "收集2026年8月6日至今天中国AI大模型企业资本动态，包括融资、IPO、战略投资、并购和重要资本合作，并从一级市场投资角度简要述评，不超过500字。";
const oneOff = parseNaturalLanguageFallbackAt(oneOffDescription, "Asia/Shanghai", now);
assert.equal(oneOff.questions.length, 0);
assert.equal(oneOff.task.executionMode, "manual");
assert.equal(oneOff.task.scheduleConfig, null);
assert.equal(oneOff.task.lookbackPeriod.kind, "custom");
assert.equal(oneOff.task.maxItems, 10, "字数限制不得被误解析为信息条数");
assert.match(oneOff.task.outputInstructions, /融资、IPO、战略投资、并购和重要资本合作/);
assert.match(oneOff.task.outputInstructions, /不超过500字/);

const explicitMonth = parseNaturalLanguageFallbackAt("中国机器人企业2026年8月资本动态", "Asia/Shanghai", now);
assert.equal(explicitMonth.task.lookbackPeriod.kind, "custom");
assert.equal(explicitMonth.task.lookbackPeriod.start, "2026-08-01T00:00:00.000Z");
assert.equal(explicitMonth.task.lookbackPeriod.end, now.toISOString(), "未完结月份的结束时间应收敛到今天");

const bareMonth = parseNaturalLanguageFallbackAt("中国机器人企业8月资本动态", "Asia/Shanghai", now);
assert.equal(bareMonth.task.lookbackPeriod.kind, "custom", "裸月（无年份）应解析为最近一个自然月");
assert.equal(bareMonth.task.lookbackPeriod.start, "2026-08-01T00:00:00.000Z");

const pastMonth = parseNaturalLanguageFallbackAt("研究2024年8月资本动态", "Asia/Shanghai", now);
assert.equal(pastMonth.task.lookbackPeriod.kind, "custom");
assert.equal(pastMonth.task.lookbackPeriod.start, "2024-08-01T00:00:00.000Z");
assert.equal(pastMonth.task.lookbackPeriod.end, "2024-08-31T00:00:00.000Z", "已过月份应覆盖完整自然月");

const monthDurationNotScope = parseNaturalLanguageFallback("最近一个月国内AI融资动态");
assert.equal(monthDurationNotScope.task.lookbackPeriod.kind, "days");
assert.equal(monthDurationNotScope.task.lookbackPeriod.value, 30, "“最近一个月”是时长而非 1 月范围");

const innovationDrug = parseNaturalLanguageFallback("研究最近一周中国创新药海外BD交易");
assert.equal(innovationDrug.task.executionMode, "manual");
assert.equal(innovationDrug.questions.length, 0);
assert.equal(innovationDrug.task.lookbackPeriod.value, 7);

const commercialSpace = parseNaturalLanguageFallback("帮我看看今天北京商业航天有哪些融资动态");
assert.equal(commercialSpace.task.executionMode, "manual");
assert.equal(commercialSpace.questions.length, 0);
assert.equal(commercialSpace.task.lookbackPeriod.value, 1);

const daily = parseNaturalLanguageFallback("每天上午9点跟踪中国AI大模型融资动态");
assert.equal(daily.task.executionMode, "scheduled");
assert.equal(daily.task.scheduleConfig?.frequency, "daily");
assert.equal(daily.task.scheduleConfig?.time, "09:00");

const weeklyWithoutTime = parseNaturalLanguageFallback("每周跟踪创新药BD");
assert.equal(weeklyWithoutTime.task.executionMode, "manual");
assert.equal(weeklyWithoutTime.task.scheduleConfig, null);
assert.equal(weeklyWithoutTime.questions.length, 1);

const failedAI = planFromAIOrFallback(oneOffDescription, "not-json", "Asia/Shanghai");
assert.equal(failedAI.task.executionMode, "manual");
assert.equal(failedAI.task.scheduleConfig, null);
assert.equal(failedAI.questions.length, 0);
assert.equal(failedAI.task.lookbackPeriod.kind, "custom");
assert.equal(failedAI.questions.some((question) => question.includes("持续关注哪个行业")), false);

const aiManualWithSpuriousQuestion = planFromAI(oneOffDescription, JSON.stringify({
  task: { name: "中国AI大模型企业资本动态", topics: [], entities: [], executionMode: "manual", scheduleConfig: null },
  questions: ["你最想持续关注哪个行业、公司、机构或赛事？"],
}));
assert.equal(aiManualWithSpuriousQuestion.questions.length, 0, "完整的一次性任务不得被 AI 的填字段追问阻断");

const component = readFileSync(join(process.cwd(), "src/components/data-apps/IntelligenceSubscriptions.tsx"), "utf8");
for (const phrase of ["不展示默认新闻流", "未订制时不生成", "不主动推送", "信息负担", "泛新闻流", "本模块不支持", "本模块不包含"]) {
  assert.equal(component.includes(phrase), false, `内部文案未清理: ${phrase}`);
}
for (const phrase of ["你想了解什么？", "生成任务方案", "可以是一次性研究，也可以设置持续跟踪"]) {
  assert.equal(component.includes(phrase), true, `缺少一次性任务界面文案: ${phrase}`);
}
console.log("intelligence natural-language tests passed");
