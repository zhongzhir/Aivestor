import type { Candidate, IntelligenceTaskInput } from "@/lib/intelligence";

const CAPITAL_EVENTS = /融资|投资|估值|并购|收购|IPO|上市|股权|募资|轮次|基金|首付款|金额/;
const POLICY_EVENTS = /政策|监管|补贴|许可|条例|规划|通知|办法|保费|政府|发改|工信|航天局/;
const BD_EVENTS = /授权|license(?:[- ]?out)?|licensing|联合开发|共同开发|全球权益|跨境合作|海外合作|交易/;
const CONCRETE_ACTIONS = /完成|达成|签约|发布|公告|批准|获批|宣布|披露|成立|设立|落地|启动|获得/;
const PRODUCT_ONLY = /公测|发布模型|模型发布|产品发布|新品|技术突破|火箭回收|技术路线/;

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
