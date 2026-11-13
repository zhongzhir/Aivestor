export type WorkIntentId =
  | "company-analysis"
  | "batch-screening"
  | "industry-research"
  | "due-diligence"
  | "ic-preparation"
  | "intelligence";

export interface WorkIntentDefinition {
  id: WorkIntentId;
  label: string;
  helper: string;
  keywords: RegExp[];
}

export const WORK_INTENTS: WorkIntentDefinition[] = [
  {
    id: "company-analysis",
    label: "项目分析",
    helper: "新建项目并上传一份或多份材料",
    keywords: [/分析|研究|评估|判断|看懂|项目|公司|商业计划|\bBP\b/i],
  },
  {
    id: "batch-screening",
    label: "批量初筛",
    helper: "集中比较多份项目材料",
    keywords: [/批量|多份|一批|初筛|筛选|比较|候选|项目池/],
  },
  {
    id: "industry-research",
    label: "行业研究",
    helper: "进入行业与竞争分析框架",
    keywords: [/行业|赛道|市场|竞争格局|竞品|产业链|市场规模|波特/],
  },
  {
    id: "due-diligence",
    label: "尽调准备",
    helper: "形成访谈问题和核验清单",
    keywords: [/尽调|尽职调查|访谈|核验|调查清单|资料清单|风险清单/],
  },
  {
    id: "ic-preparation",
    label: "投资决策",
    helper: "选择项目后进入 IC 工作区",
    keywords: [/\bIC\b/i, /投委会|投资决策|上会|决策材料|投资建议|是否投资/],
  },
  {
    id: "intelligence",
    label: "持续情报",
    helper: "创建一次性研究或持续监测主题",
    keywords: [/情报|跟踪|监测|持续关注|每周|每天|定期|动态|新闻|舆情/],
  },
];

const PRIORITY: WorkIntentId[] = [
  "batch-screening",
  "ic-preparation",
  "due-diligence",
  "intelligence",
  "industry-research",
  "company-analysis",
];

export function classifyWorkIntent(input: string): WorkIntentId {
  const text = input.trim();
  if (!text) return "company-analysis";

  const scores = WORK_INTENTS.map((intent) => ({
    id: intent.id,
    score: intent.keywords.reduce(
      (total, keyword) => total + (keyword.test(text) ? 1 : 0),
      0
    ),
  }));
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id);
  });
  return scores[0].score > 0 ? scores[0].id : "company-analysis";
}

export function buildWorkIntentHref(intent: WorkIntentId, input: string): string {
  const brief = input.trim().slice(0, 2_000);
  const query = new URLSearchParams();
  if (brief) query.set("brief", brief);

  switch (intent) {
    case "batch-screening":
      return `/projects/screening/new${query.size ? `?${query}` : ""}`;
    case "industry-research":
      query.set("scene", "industry-research");
      return `/skills?${query}`;
    case "due-diligence":
      query.set("scene", "due-diligence");
      return `/skills?${query}`;
    case "ic-preparation":
      query.set("focus", "ic");
      return `/projects?${query}`;
    case "intelligence":
      query.set("new", "1");
      return `/data-apps/intelligence-subscriptions?${query}`;
    default:
      return `/projects/new${query.size ? `?${query}` : ""}`;
  }
}

export function workIntentDefinition(id: WorkIntentId): WorkIntentDefinition {
  return WORK_INTENTS.find((intent) => intent.id === id) ?? WORK_INTENTS[0];
}
