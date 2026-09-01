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
assert.equal(ambiguous.task.executionMode, "scheduled", "周期意图明确时应使用合理默认值直接创建");
assert.deepEqual(ambiguous.task.scheduleConfig?.weekdays, [5], "未指定星期的每周任务默认周五");
assert.equal(ambiguous.task.scheduleConfig?.time, "08:00", "未指定时间时默认上午8点");
assert.equal(ambiguous.questions.length, 0, "可使用默认值的配置不得追问用户");

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
assert.ok(bareMonth.task.topics.some((topic) => /机器人/.test(topic)), "应保留用户明确的机器人主题");
assert.ok(bareMonth.task.includeRequirements.includes("资本动态"), "应保留用户明确的资本事件类型");

const staleAiPlan = planFromAI("中国机器人企业8月资本动态", JSON.stringify({
  task: {
    name: "中国机器人企业8月资本动态",
    topics: ["机器人企业"],
    keywords: ["资本动态"],
    lookbackPeriod: { kind: "custom", start: "2024-08-01T00:00:00.000Z", end: "2024-08-31T00:00:00.000Z" },
    executionMode: "manual",
  },
  questions: [],
}), "Asia/Shanghai");
assert.equal(staleAiPlan.task.lookbackPeriod.start, "2026-08-01T00:00:00.000Z", "AI 不得覆盖用户的裸月份年份");
assert.equal(new Date(staleAiPlan.task.lookbackPeriod.end ?? "").getUTCFullYear(), 2026);
assert.equal(new Date(staleAiPlan.task.lookbackPeriod.end ?? "").getUTCMonth(), 7);
assert.ok(new Date(staleAiPlan.task.lookbackPeriod.end ?? "").getTime() <= Date.now(), "未结束月份的结束时间不得晚于当前时间");
assert.ok(staleAiPlan.task.topics.some((topic) => /机器人/.test(topic)));

for (const [description, expectedTopic, expectedEvent] of [
  ["中国创新药企业8月融资与授权动态", "创新药", "融资"],
  ["北京商业航天企业2026年7月融资与政策动态", "商业航天", "融资"],
  ["中国AI大模型企业最近一周资本动态", "AI大模型", "资本动态"],
] as const) {
  const plan = parseNaturalLanguageFallbackAt(description, "Asia/Shanghai", now);
  assert.ok(plan.task.topics.includes(expectedTopic), `${description} 应保留主题`);
  assert.ok(plan.task.includeRequirements.includes(expectedEvent), `${description} 应保留事件类型`);
  assert.ok(plan.task.topics.every((topic) => !/20\d{2}|最近|\d+月/.test(topic)), `${description} 主题不应携带时间词`);
}

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
assert.equal(weeklyWithoutTime.task.executionMode, "scheduled");
assert.deepEqual(weeklyWithoutTime.task.scheduleConfig?.weekdays, [5]);
assert.equal(weeklyWithoutTime.task.scheduleConfig?.time, "08:00");
assert.equal(weeklyWithoutTime.questions.length, 0);

const explicitFriday = parseNaturalLanguageFallback("关注北京大模型公司的资本动态。每周五更新一次。");
assert.equal(explicitFriday.task.executionMode, "scheduled");
assert.deepEqual(explicitFriday.task.scheduleConfig?.weekdays, [5], "用户已经说明周五时不得再次追问星期");
assert.equal(explicitFriday.task.scheduleConfig?.time, "08:00", "缺少时间时采用产品默认值");
assert.equal(explicitFriday.questions.length, 0);

const countMustNotBecomeTime = parseNaturalLanguageFallback("每周五关注北京大模型公司资本动态，不超过10条");
assert.equal(countMustNotBecomeTime.task.scheduleConfig?.time, "08:00", "数量等普通数字不得误解析为执行时间");
assert.equal(countMustNotBecomeTime.task.maxItems, 10);

const aiMustNotOverrideSchedule = planFromAI("每周五关注创新药BD", JSON.stringify({
  task: { name: "创新药BD", executionMode: "scheduled", scheduleConfig: { frequency: "weekly", weekdays: [1], time: "18:00", timezone: "UTC" } },
  questions: ["请确认星期和时间"],
}));
assert.deepEqual(aiMustNotOverrideSchedule.task.scheduleConfig?.weekdays, [5], "AI 不得覆盖用户明确表达的星期");
assert.equal(aiMustNotOverrideSchedule.task.scheduleConfig?.time, "08:00", "AI 不得用猜测覆盖产品默认时间");
assert.equal(aiMustNotOverrideSchedule.questions.length, 0);

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
for (const phrase of ["一句话订制你的情报", "开始订制", "正在理解并创建", "一次性研究和持续跟踪都可以", "正在检索并整理本期信息", "重新生成", "本期结论"]) {
  assert.equal(component.includes(phrase), true, `缺少订制主流程或执行反馈文案: ${phrase}`);
}
assert.equal(component.includes("星期（0=周日"), false, "不得要求普通用户理解程序使用的星期数字");
for (const phrase of ["系统理解如下", "补充这句话", "修改这句话", "确认创建"]) {
  assert.equal(component.includes(phrase), false, `自然语言主流程不得保留二次考试式确认: ${phrase}`);
}
assert.match(component, /await createTask\(nextPlan\)/, "理解自然语言后应直接创建任务");
assert.match(component, /await action\(data\.task, "generate"\)/, "一次性研究创建后应直接生成，不得要求第二次点击");
console.log("intelligence natural-language tests passed");
