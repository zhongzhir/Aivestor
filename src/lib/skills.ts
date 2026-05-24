// SKILL 广场常量与类型（前后端共用）

export const SKILL_CATEGORIES = [
  { value: "analysis", label: "分析框架", icon: "🔍" },
  { value: "due_diligence", label: "尽调工具", icon: "📋" },
  { value: "valuation", label: "估值决策", icon: "💰" },
  { value: "post_investment", label: "投后管理", icon: "📊" },
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]["value"];

export const CATEGORY_ICONS: Record<string, string> = {
  analysis: "🔍",
  due_diligence: "📋",
  valuation: "💰",
  post_investment: "📊",
};

export const CATEGORY_LABELS: Record<string, string> = {
  analysis: "分析框架",
  due_diligence: "尽调工具",
  valuation: "估值决策",
  post_investment: "投后管理",
};

// SKILL 适用阶段标签（与投资流程阶段对应）
export const STAGE_LABELS: Record<string, string> = {
  screening: "初筛",
  due_diligence: "尽调",
  investment_committee: "投委会",
  post_investment: "投后",
};

export const SKILL_STAGES = [
  "screening",
  "due_diligence",
  "investment_committee",
  "post_investment",
] as const;

export function isValidSkillCategory(v: unknown): v is SkillCategory {
  return (
    typeof v === "string" &&
    SKILL_CATEGORIES.some((c) => c.value === v)
  );
}

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[];
  skillType: "catalog" | "custom";
  prompt_template?: string;
}
