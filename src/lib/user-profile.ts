import { query } from "@/lib/db";

// 投资人画像：用户的专业方向与判断偏好。
// 调用大模型前会被格式化并前置注入到 system prompt，
// 让 AI 输出更贴合个人风格。

export type InvestmentStyle =
  | "financial"
  | "strategic"
  | "founder_first"
  | "thesis_driven";

export interface ScreeningCriteria {
  hard_pass: string[];
  preferred_stages?: string[];
  preferred_sectors?: string[];
}

export interface UserProfile {
  user_id: string;
  focus_stages: string[];
  focus_sectors: string[];
  investment_style: InvestmentStyle | null;
  check_size: string | null;
  typical_hold_period: string | null;
  self_intro: string | null;
  decision_criteria: string | null;
  avoid_patterns: string | null;
  output_preference: string | null;
  extra_context: string | null;
  screening_criteria: ScreeningCriteria | null;
}

export interface ProfilePromptContext {
  projectName?: string | null;
  companyName?: string | null;
  industry?: string | null;
  stage?: string | null;
  projectJudgments?: string[] | null;
  explicitInstruction?: string | null;
  taskText?: string | null;
}

// pg 在某些情况下会把 JSONB 列直接以字符串返回，统一解析为对象
function parseScreeningCriteria(
  raw: unknown
): ScreeningCriteria | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    hard_pass: toStrArr(o.hard_pass),
    preferred_stages: toStrArr(o.preferred_stages),
    preferred_sectors: toStrArr(o.preferred_sectors),
  };
}

const STYLE_LABEL: Record<InvestmentStyle, string> = {
  financial: "财务回报导向",
  strategic: "战略布局导向",
  founder_first: "Founder 优先",
  thesis_driven: "主题投资",
};

const CLAUSE_SEPARATOR = /[\n。！？；;]+|(?:\r?\n)?\s*[-•●]\s*/;
const PROJECT_SPECIFIC_MARKERS = [
  "排除",
  "不投",
  "不考虑",
  "避免",
  "回避",
  "禁止",
  "不得",
  "只投",
  "偏好",
  "倾向",
  "优先",
];
const BROAD_SCOPE_MARKERS = [
  "所有项目",
  "任何项目",
  "所有行业",
  "始终",
  "一贯",
  "无论",
  "通常",
];
const SCALE_TASK_PATTERN =
  /(融资|估值|持股|投资金额|投资额|本轮|领投|跟投|资金匹配|资金占用|组合配置|出资|股权比例)/;
const HOLD_PERIOD_TASK_PATTERN =
  /(退出|回报周期|流动性|项目成熟度|上市|并购|分红|基金期限|持有周期|退出路径|期限匹配)/;
const SCALE_IGNORE_PATTERN =
  /(忽略|不考虑|无需|不要|不涉及|不做|不分析)[^。！？\n]{0,16}(融资|估值|持股|投资金额|资金|配置|股权)/;
const HOLD_PERIOD_IGNORE_PATTERN =
  /(忽略|不考虑|无需|不要|不涉及|不做|不分析)[^。！？\n]{0,16}(退出|回报周期|流动性|持有期限|基金期限|期限)/;

function normalizePromptText(value: string): string {
  return value.toLowerCase().replace(/[\s_\-—–]/g, "");
}

function contextTerms(context: ProfilePromptContext): string[] {
  const values = [
    context.projectName,
    context.companyName,
    context.industry,
    context.stage,
    ...(context.projectJudgments ?? []),
  ]
    .filter((value): value is string => !!value?.trim())
    .map(normalizePromptText);

  const terms = new Set<string>();
  for (const value of values) {
    if (value.length >= 2) terms.add(value);
    // 保留中文行业/赛道短语，覆盖“农业”匹配“农业科技”这类情况。
    const chineseRuns = value.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    for (const run of chineseRuns) {
      for (let size = 2; size <= Math.min(6, run.length); size += 1) {
        for (let start = 0; start + size <= run.length; start += 1) {
          terms.add(run.slice(start, start + size));
        }
      }
    }
    for (const token of value.split(/[^a-z0-9\u4e00-\u9fff]+/i)) {
      if (token.length >= 2) terms.add(token);
    }
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

function taskText(context: ProfilePromptContext): string {
  return normalizePromptText(
    [context.taskText, context.explicitInstruction].filter(Boolean).join("\n")
  );
}

function shouldUseTaskPreference(
  context: ProfilePromptContext,
  pattern: RegExp,
  ignorePattern: RegExp
): boolean {
  const text = taskText(context);
  return !!text && pattern.test(text) && !ignorePattern.test(text);
}

function styleGuidance(style: InvestmentStyle): string {
  switch (style) {
    case "financial":
      return "优先提高财务确定性、现金流和可验证指标的判断权重";
    case "strategic":
      return "优先观察产业协同、战略价值和资源兑现路径的判断依据";
    case "founder_first":
      return "优先观察创始团队的能力、动机、执行力和关键人风险";
    case "thesis_driven":
      return "优先核查项目与明确投资主题的契合度及主题成立所需条件";
  }
}

function splitClauses(value: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(CLAUSE_SEPARATOR)
    .map((part) => part.replace(/^[:：,，、]+|[:：,，、]+$/g, "").trim())
    .filter(Boolean);
}

function isProjectRelevantClause(clause: string, terms: string[]): boolean {
  const normalized = normalizePromptText(clause);
  if (BROAD_SCOPE_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }
  if (terms.some((term) => normalized.includes(term))) return true;
  // 普适的判断标准可以适用于所有项目；带有明确对象/赛道限定的偏好必须命中当前项目。
  return !PROJECT_SPECIFIC_MARKERS.some((marker) => normalized.includes(marker));
}

function filterClauses(value: string | null, terms: string[]): string[] {
  return splitClauses(value).filter((clause) =>
    isProjectRelevantClause(clause, terms)
  );
}

export function getRelevantHardPassItems(
  profile: UserProfile,
  context: ProfilePromptContext = {}
): string[] {
  return filterClauses(
    profile.screening_criteria?.hard_pass?.join("\n") ?? null,
    contextTerms(context)
  );
}

function filterList(values: string[] | null | undefined, terms: string[]): string[] {
  return (values ?? []).filter((value) => {
    const normalized = normalizePromptText(value);
    return terms.some((term) => normalized.includes(term));
  });
}

export function formatRelevantProfileForPrompt(
  profile: UserProfile,
  context: ProfilePromptContext = {}
): string {
  const terms = contextTerms(context);
  const lines: string[] = ["## 与当前项目相关的投资人画像"];

  const stages = filterList(profile.focus_stages, terms);
  const sectors = filterList(profile.focus_sectors, terms);
  if (stages.length) lines.push(`相关关注阶段：${stages.join("、")}`);
  if (sectors.length) lines.push(`相关关注赛道：${sectors.join("、")}`);
  if (profile.investment_style && (context.projectName || context.taskText)) {
    lines.push(
      `分析倾向（仅用于调整判断权重，不要在报告中机械复述）：${styleGuidance(profile.investment_style)}`
    );
  }
  if (
    profile.check_size &&
    shouldUseTaskPreference(context, SCALE_TASK_PATTERN, SCALE_IGNORE_PATTERN)
  ) {
    lines.push(`资金匹配分析参考：${profile.check_size}`);
  }
  if (
    profile.typical_hold_period &&
    shouldUseTaskPreference(
      context,
      HOLD_PERIOD_TASK_PATTERN,
      HOLD_PERIOD_IGNORE_PATTERN
    )
  ) {
    lines.push(`期限与退出分析参考：${profile.typical_hold_period}`);
  }

  const criteria = filterClauses(profile.decision_criteria, terms);
  const avoid = filterClauses(profile.avoid_patterns, terms);
  const extra = filterClauses(profile.extra_context, terms);
  if (criteria.length) lines.push(`相关判断标准：${criteria.join("；")}`);
  if (avoid.length) lines.push(`相关回避项：${avoid.join("；")}`);
  if (profile.self_intro) lines.push(`补充背景：${profile.self_intro}`);
  if (extra.length) lines.push(`相关补充：${extra.join("；")}`);

  const hardPass = getRelevantHardPassItems(profile, context);
  if (hardPass.length) {
    lines.push("## 与当前项目相关的硬性核查项");
    for (const item of hardPass) lines.push(`- ${item}`);
  }

  if (profile.output_preference) {
    lines.push(`输出习惯（最低优先级）：${profile.output_preference}`);
  }

  return lines.length === 1 ? "" : lines.join("\n");
}

export async function getUserProfile(
  userId: string
): Promise<UserProfile | null> {
  const rows = await query<UserProfile>(
    `SELECT user_id, focus_stages, focus_sectors, investment_style,
            check_size, typical_hold_period, self_intro, decision_criteria,
            avoid_patterns, output_preference, extra_context,
            screening_criteria
       FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    screening_criteria: parseScreeningCriteria(row.screening_criteria),
  };
}

// 将画像格式化为自然语言段落，注入到 system prompt 最前面。
// 字段为空则跳过对应行，避免输出空白条目。
export function formatProfileForPrompt(profile: UserProfile): string {
  const lines: string[] = ["## 关于这位投资人"];

  if (profile.focus_stages?.length) {
    lines.push(`专注阶段：${profile.focus_stages.join("、")}`);
  }
  if (profile.focus_sectors?.length) {
    lines.push(`关注赛道：${profile.focus_sectors.join("、")}`);
  }
  if (profile.investment_style) {
    lines.push(`投资风格：${STYLE_LABEL[profile.investment_style]}`);
  }
  if (profile.check_size) {
    lines.push(`单笔规模：${profile.check_size}`);
  }
  if (profile.typical_hold_period) {
    lines.push(`典型持有周期：${profile.typical_hold_period}`);
  }
  if (profile.decision_criteria) {
    lines.push(`核心判断标准：${profile.decision_criteria}`);
  }
  if (profile.avoid_patterns) {
    lines.push(`明确回避：${profile.avoid_patterns}`);
  }
  if (profile.output_preference) {
    lines.push(`输出偏好：${profile.output_preference}`);
  }
  if (profile.self_intro) {
    lines.push(`补充背景：${profile.self_intro}`);
  }
  if (profile.extra_context) {
    lines.push(`其他补充：${profile.extra_context}`);
  }

  // 结构化硬性否决项 — 让模型在简要分析时优先核查
  const sc = profile.screening_criteria;
  if (sc && sc.hard_pass && sc.hard_pass.length > 0) {
    lines.push("");
    lines.push("## 硬性否决项（命中任一直接 PASS，无需深入分析）");
    for (const item of sc.hard_pass) {
      lines.push(`- ${item}`);
    }
  }

  // 只有标题行说明没有任何字段填写
  if (lines.length === 1) return "";
  return lines.join("\n");
}

// 在原 system prompt 前注入投资人画像；查询失败静默降级。
export async function injectProfile(
  userId: string,
  originalSystem: string,
  context: ProfilePromptContext = {}
): Promise<string> {
  try {
    const profile = await getUserProfile(userId);
    if (!profile) return originalSystem;
    const section = formatRelevantProfileForPrompt(profile, context);
    if (!section) return originalSystem;
    const priorityLines = [
      "## 本次分析的上下文优先级",
      context.explicitInstruction?.trim()
        ? `1. 本次明确要求（最高优先级）：${context.explicitInstruction.trim()}`
        : "1. 本次明确要求（最高优先级）：以当前请求中的具体要求为准。",
      context.projectJudgments?.filter(Boolean).length
        ? `2. 当前项目判断：${context.projectJudgments.filter(Boolean).join("；")}`
        : "2. 当前项目判断：以当前项目材料和已记录判断为准。",
      "3. 长期投资偏好：仅使用上方与当前项目直接相关的部分，不要逐条照搬无关偏好。",
      "4. 输出习惯：只影响表达方式，不得改变项目事实、判断依据或结论。",
    ].join("\n");
    return `${priorityLines}\n\n${section}\n\n---\n\n${originalSystem}`;
  } catch {
    return originalSystem;
  }
}
