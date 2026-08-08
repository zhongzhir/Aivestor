import type { Candidate, IntelligenceTaskInput } from "@/lib/intelligence";

const CAPITAL_EVENTS = /融资|投资|估值|并购|收购|IPO|上市|股权|募资|轮次|基金|首付款|金额/;
const POLICY_EVENTS = /政策|监管|补贴|许可|条例|规划|通知|办法|保费|政府|发改|工信|航天局/;
const BD_EVENTS = /授权|license(?:[- ]?out)?|licensing|联合开发|共同开发|全球权益|跨境合作|海外合作|交易/;
const CONCRETE_ACTIONS = /完成|达成|签约|发布|公告|批准|获批|宣布|披露|成立|设立|落地|启动|获得/;
const PRODUCT_ONLY = /公测|发布模型|模型发布|产品发布|新品|技术突破|火箭回收|技术路线/;
const REVIEW_MARKERS = /一季度|二季度|三季度|四季度|上半年|下半年|年度|年初至今|一年|近一年|过去一年|1[-至～—]3月|盘点|回顾|复盘|综述|行业报告|融资周报|月报|周报|创新高|深度|解析|简析|结构|评论|观点/;
const AGGREGATE_MARKERS = /交易额|交易金额|交易数量|累计|突破|逼近|多家|家企业|行业|市场|景气|总额|密集|创新高|结构/;

function textFor(candidate: Candidate): string {
  return `${candidate.title} ${candidate.content} ${candidate.subject} ${candidate.region ?? ""}`.toLocaleLowerCase();
}

function hasAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value.toLocaleLowerCase()));
}

/** 轻量事件类型门：低相关内容直接丢弃，不降级为线索。 */
export function topicRelevance(candidate: Candidate, input: IntelligenceTaskInput): { passed: boolean; reason?: string } {
  const text = textFor(candidate);
  const requested = `${input.name} ${input.topics.join(" ")} ${input.keywords.join(" ")} ${input.includeRequirements.join(" ")}`.toLocaleLowerCase();
  const explicitCapital = CAPITAL_EVENTS.test(requested) || /资本|融资|投资|估值|并购|股权/.test(requested);
  const explicitPolicy = POLICY_EVENTS.test(requested) || /政策|监管/.test(requested);
  const explicitBd = /海外|跨境|bd|license|授权|联合开发/.test(requested);
  const action = CONCRETE_ACTIONS.test(text);

  if (input.regions.length && !hasAny(text, input.regions)) return { passed: false, reason: "region-mismatch" };
  if (explicitBd) {
    if (!BD_EVENTS.test(text) || (!/海外|跨境|全球|license|licensing|联合开发|共同开发/.test(text) && /诉讼|法院|股价|财报/.test(text))) return { passed: false, reason: "bd-event-mismatch" };
    return { passed: true };
  }
  if (explicitCapital && !CAPITAL_EVENTS.test(text)) return { passed: false, reason: "capital-event-mismatch" };
  if (explicitPolicy && !POLICY_EVENTS.test(text) && !CAPITAL_EVENTS.test(text)) return { passed: false, reason: "policy-event-mismatch" };
  if ((explicitCapital || explicitPolicy) && !action && !/融资|投资|估值|政策|补贴|监管|并购|收购|IPO|上市|基金/.test(text)) return { passed: false, reason: "no-concrete-event" };
  if (explicitCapital && PRODUCT_ONLY.test(text) && !CAPITAL_EVENTS.test(text)) return { passed: false, reason: "product-only" };
  if (!explicitCapital && !explicitPolicy && !explicitBd && input.topics.length && !hasAny(text, input.topics)) return { passed: false, reason: "topic-mismatch" };
  return { passed: true };
}

/** 最近发布的统计/回顾文章不等于本期新增事件；有明确主体的单一事件报道除外。 */
export function isHistoricalReviewCandidate(candidate: Candidate, input: IntelligenceTaskInput): boolean {
  const text = `${candidate.title} ${candidate.content}`;
  const requestedReview = /趋势|复盘|回顾|统计|综述|盘点/.test(`${input.name} ${input.keywords.join(" ")} ${input.includeRequirements.join(" ")}`);
  const hasNamedEntity = /(?:公司|集团|医药|制药|药业|生物|科技|航天|火箭|卫星|月之暗面|DeepSeek|OpenAI|Anthropic)/i.test(text);
  const hasSingleEventAction = /完成融资|达成合作|完成授权|获得融资|签署协议|被曝融资|计划募资|拟融资/.test(text);
  const editorialOnly = /深度|解析|简析|评论|观点|周报|月报/.test(text) && !hasNamedEntity && !hasSingleEventAction;
  if (editorialOnly) return true;
  if (requestedReview || !REVIEW_MARKERS.test(text) || !AGGREGATE_MARKERS.test(text)) return false;
  return !(hasNamedEntity && hasSingleEventAction);
}
