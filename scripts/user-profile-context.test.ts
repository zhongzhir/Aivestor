import assert from "node:assert/strict";
import {
  formatRelevantProfileForPrompt,
  getRelevantHardPassItems,
  type UserProfile,
} from "@/lib/user-profile";

const profile: UserProfile = {
  user_id: "test-user",
  focus_stages: ["早期"],
  focus_sectors: ["农业", "文化"],
  investment_style: "thesis_driven",
  check_size: "1000万以内",
  typical_hold_period: "5年",
  self_intro: null,
  decision_criteria: "看重真实需求；排除农业项目；关注团队执行力",
  avoid_patterns: "回避纯概念项目；不投农业项目",
  output_preference: "先给结论，再列证据",
  extra_context: "文化项目重点看内容壁垒；不要泛泛复述无关行业偏好",
  screening_criteria: {
    hard_pass: ["排除农业项目", "存在重大合规风险"],
    preferred_stages: ["早期"],
    preferred_sectors: ["农业", "文化"],
  },
};

const culture = formatRelevantProfileForPrompt(profile, {
  projectName: "文化内容平台",
  industry: "文化",
  stage: "早期",
});
assert.match(culture, /文化项目重点看内容壁垒/);
assert.doesNotMatch(culture, /排除农业项目/);
assert.doesNotMatch(culture, /农业/);
assert.doesNotMatch(culture, /1000万以内/);
assert.doesNotMatch(culture, /5年/);
assert.doesNotMatch(culture, /投资风格：/);
assert.match(culture, /分析倾向（仅用于调整判断权重/);
assert.match(culture, /输出习惯（最低优先级）/);

const agriculture = formatRelevantProfileForPrompt(profile, {
  projectName: "农业科技服务平台",
  industry: "农业科技",
  stage: "早期",
});
assert.match(agriculture, /排除农业项目/);
assert.match(agriculture, /农业/);
assert.deepEqual(
  getRelevantHardPassItems(profile, { industry: "文化" }),
  ["存在重大合规风险"]
);
assert.deepEqual(
  getRelevantHardPassItems(profile, { industry: "农业科技" }),
  ["排除农业项目", "存在重大合规风险"]
);

const financing = formatRelevantProfileForPrompt(profile, {
  projectName: "文化科技平台",
  industry: "文化科技",
  taskText: "评估本轮融资需求、估值、持股比例和资金匹配度",
});
assert.match(financing, /资金匹配分析参考：1000万以内/);
assert.doesNotMatch(financing, /典型持有周期/);

const financingOverride = formatRelevantProfileForPrompt(profile, {
  projectName: "文化科技平台",
  industry: "文化科技",
  taskText: "评估本轮融资需求和资金匹配度",
  explicitInstruction: "本次明确忽略资金匹配，只分析团队能力",
});
assert.doesNotMatch(financingOverride, /1000万以内/);

const exit = formatRelevantProfileForPrompt(profile, {
  projectName: "文化科技平台",
  industry: "文化科技",
  taskText: "分析退出路径、上市或并购可能性以及流动性",
});
assert.match(exit, /期限与退出分析参考：5年/);

const unrelatedTask = formatRelevantProfileForPrompt(profile, {
  projectName: "文化科技平台",
  industry: "文化科技",
  taskText: "只分析团队执行力和技术判断，不涉及融资和退出",
});
assert.doesNotMatch(unrelatedTask, /1000万以内/);
assert.doesNotMatch(unrelatedTask, /5年/);

console.log("user-profile-context tests passed");
