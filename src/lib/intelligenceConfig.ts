export const INTELLIGENCE_PLAN_LIMITS = {
  personal: {
    maxActiveTasks: 3,
    maxItems: 20,
    maxScheduleFrequency: "daily" as const,
  },
  organization: {
    maxActiveTasks: 20,
    maxItems: 50,
    maxScheduleFrequency: "daily" as const,
  },
} as const;

// 简报目前基于已有 market_insights 生成；这笔固定估算用于统一计入平台额度。
export const INTELLIGENCE_GENERATION_ESTIMATED_TOKENS = 2_000;
