import assert from "node:assert/strict";
import { formatIntelligencePersonalizationPrompt } from "@/lib/intelligencePersonalization";
import type { IntelligenceTaskInput } from "@/lib/intelligence";
import type { UserProfile } from "@/lib/user-profile";

const task: IntelligenceTaskInput = {
  name: "中国大模型企业资本动态",
  topics: ["大模型", "资本动态"], entities: [], keywords: [], regions: ["中国"],
  includeRequirements: [], excludeRequirements: [], maxItems: 10,
  lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "突出投资影响",
  executionMode: "manual", scheduleConfig: null, isActive: true,
};
const profile: UserProfile = {
  user_id: "u1", focus_stages: ["早期"], focus_sectors: ["大模型"], investment_style: "thesis_driven",
  check_size: null, typical_hold_period: null, self_intro: "关注 AI 基础设施和产业落地",
  decision_criteria: "看重真实客户需求", avoid_patterns: "回避纯概念项目", output_preference: "先给结论", extra_context: null,
  screening_criteria: { hard_pass: [], preferred_stages: [], preferred_sectors: [] },
};
const result = formatIntelligencePersonalizationPrompt({
  profile,
  projects: [{ id: "p1", name: "宇树科技", companyName: "宇树", industry: "机器人", stage: "B轮", status: "invested", summary: "智能机器人项目" }],
  judgments: [{ projectId: "p1", projectName: "宇树科技", stage: "post_invest", judgmentType: "note", title: "关联观察", content: "关注模型能力与机器人落地的结合" }],
  task,
});
assert.equal(result.profileUsed, true);
assert.deepEqual(result.projectIds, ["p1"]);
assert.equal(result.judgmentCount, 1);
assert.match(result.prompt, /关联优先级/);
assert.match(result.prompt, /宇树科技/);
assert.match(result.prompt, /模型能力与机器人落地/);
console.log("intelligence personalization tests passed");
