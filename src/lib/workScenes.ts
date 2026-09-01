export type WorkScene = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  input: string;
  output: string;
  href: string;
};

export const WORK_SCENES: WorkScene[] = [
  {
    id: "company-analysis",
    eyebrow: "企业分析",
    title: "快速看懂一个项目",
    description: "从 BP 和补充材料开始，先形成一版可继续推进的项目判断。",
    input: "BP 或项目材料",
    output: "项目工作区与初步分析",
    href: "/projects/new",
  },
  {
    id: "batch-screening",
    eyebrow: "项目筛选",
    title: "批量初筛多份 BP",
    description: "分别阅读候选材料，集中查看结论、风险、信息缺口和证据。",
    input: "多份 PDF 或 DOCX",
    output: "初筛汇总与候选晋级",
    href: "/projects/screening/new",
  },
  {
    id: "industry-research",
    eyebrow: "行业研究",
    title: "梳理赛道与竞争格局",
    description: "用现有分析框架识别行业结构、竞争者和项目的真实壁垒。",
    input: "行业或关联项目",
    output: "行业与竞争分析",
    href: "/skills?scene=industry-research",
  },
  {
    id: "due-diligence",
    eyebrow: "尽调准备",
    title: "准备访谈与尽调清单",
    description: "围绕项目风险和关键假设，组织下一轮需要核实的问题。",
    input: "已有项目",
    output: "访谈提纲或尽调清单",
    href: "/skills?scene=due-diligence",
  },
  {
    id: "ic-preparation",
    eyebrow: "投资决策",
    title: "准备 IC 讨论",
    description: "从现有项目进入投资决策，整理证据、风险与未解决问题。",
    input: "项目材料与判断",
    output: "IC Memo 与决策记录",
    href: "/projects?focus=ic",
  },
  {
    id: "intelligence",
    eyebrow: "持续跟踪",
    title: "订制市场情报",
    description: "按关注范围和时间节奏，持续跟踪行业、公司和重要事件。",
    input: "关注主题与范围",
    output: "可回看的情报简报",
    href: "/data-apps/intelligence-subscriptions",
  },
];

export const SKILL_SCENES = [
  {
    id: "industry-research",
    title: "行业与竞争格局",
    description: "判断赛道结构、竞品和真实壁垒",
    input: "行业或关联项目",
    output: "行业研究与竞争分析",
    category: "analysis",
    keywords: ["行业", "竞争", "赛道", "波特"],
  },
  {
    id: "company-analysis",
    title: "企业快速诊断",
    description: "用成熟框架检查商业模式和关键风险",
    input: "关联项目",
    output: "结构化诊断结果",
    category: "analysis",
    keywords: ["商业模式", "风险", "快速粗筛", "诊断"],
  },
  {
    id: "founder-interview",
    title: "创始人访谈",
    description: "围绕关键假设准备有针对性的访谈问题",
    input: "关联项目",
    output: "访谈提纲与待核实事项",
    category: "due_diligence",
    keywords: ["创始人访谈", "访谈提纲", "客户访谈"],
  },
  {
    id: "due-diligence",
    title: "尽调准备",
    description: "按优先级组织商业、财务、法务和技术核查",
    input: "关联项目",
    output: "尽调清单与验证目标",
    category: "due_diligence",
    keywords: ["尽调清单", "尽职调查", "财务尽调", "合规风险"],
  },
  {
    id: "valuation",
    title: "估值判断",
    description: "检查估值假设、可比公司与安全边际",
    input: "关联项目与估值信息",
    output: "估值判断与谈判关注点",
    category: "valuation",
    keywords: ["估值", "可比公司"],
  },
  {
    id: "ic-memo",
    title: "IC Memo",
    description: "整理投资逻辑、核心风险和投委会问题",
    input: "关联项目",
    output: "IC Memo 底稿",
    category: "analysis",
    keywords: ["IC Memo", "投委会"],
  },
  {
    id: "post-investment",
    title: "投后计划",
    description: "规划里程碑、资源支持和风险预警",
    input: "已投项目",
    output: "投后计划或跟踪问卷",
    category: "post_investment",
    keywords: ["投后价值", "投后跟踪", "投后计划"],
  },
] as const;
