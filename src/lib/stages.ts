export const FLOW_STAGES = [
  "screening",
  "due_diligence",
  "investment_committee",
  "post_investment",
] as const;

export const TERMINAL_STAGES = ["passed", "exited"] as const;

export const ALL_STAGES = [...FLOW_STAGES, ...TERMINAL_STAGES] as const;

export type Stage = (typeof ALL_STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  screening: "初筛",
  due_diligence: "尽调",
  investment_committee: "投委会",
  post_investment: "投后管理",
  passed: "已 Pass",
  exited: "已退出",
};

export function isValidStage(value: unknown): value is Stage {
  return (
    typeof value === "string" &&
    (ALL_STAGES as readonly string[]).includes(value)
  );
}
