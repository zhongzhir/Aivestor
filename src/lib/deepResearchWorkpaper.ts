import type { ResolvedDeepResearchProfile } from "@/lib/deepResearch";

export type EvidenceStatus = "document" | "data" | "external" | "analysis" | "gap" | "inconsistent";
export type ResearchGateStatus = "pass" | "review" | "blocked";
export type EvidenceClaimClass =
  | "fact"
  | "negative_fact"
  | "evidence_gap"
  | "suggested_threshold"
  | "institution_parameter"
  | "analysis";

export interface EvidenceLedgerItem {
  id: string;
  claim: string;
  status: EvidenceStatus;
  citations: string[];
  investmentImpact: string;
  verificationAction: string;
  priority: "P0" | "P1" | "P2";
  claimClass?: EvidenceClaimClass;
}

export interface DeepResearchGate {
  status: ResearchGateStatus;
  requiredSectionCount: number;
  coveredSectionCount: number;
  sectionCoverageRate: number;
  evidenceItemCount: number;
  locatedEvidenceCount: number;
  locatedEvidenceRate: number;
  invalidCitations: string[];
  missingSections: string[];
  issues: string[];
}

export interface DeepResearchMetadata {
  profile: ResolvedDeepResearchProfile;
  evidenceLedger: EvidenceLedgerItem[];
  gate: DeepResearchGate;
  generatedAt: string;
  reviewStatus?: "ai_draft" | "reviewed";
}

const LEDGER_RE = /\[EVIDENCE_LEDGER_START\]([\s\S]*?)\[EVIDENCE_LEDGER_END\]/;
const VALID_STATUS = new Set<EvidenceStatus>([
  "document",
  "data",
  "external",
  "analysis",
  "gap",
  "inconsistent",
]);
const VALID_CLAIM_CLASS = new Set<EvidenceClaimClass>([
  "fact",
  "negative_fact",
  "evidence_gap",
  "suggested_threshold",
  "institution_parameter",
  "analysis",
]);

const REQUIRED_SECTIONS: Record<ResolvedDeepResearchProfile, string[]> = {
  early_stage: [
    "执行摘要与建议等级",
    "一、政策",
    "二、市场",
    "三、团队",
    "四、上下游目标",
    "五、客户定位",
    "六、初创投入",
    "七、商业模型",
    "综合研判、前置条件与触发器",
    "分级尽调清单",
    "来源索引与数字口径",
  ],
  comprehensive: [
    "一、综合评级",
    "二、公司概览",
    "三、核心产品、技术与业务架构",
    "四、客户、市场与商业化能力",
    "五、核心团队深度分析",
    "六、发展阶段与财务分析",
    "七、竞争对手深度对比",
    "八、第一曲线、第二曲线与路线图",
    "九、行业趋势、政策导向与增量机会",
    "十、核心瓶颈与风险缓释",
    "十一、融资历史与机构分析",
    "十二、投资价值与适配度",
    "十三、组织架构、人才缺口与保障",
    "十四、风险提示与补充尽调清单",
    "十五、数据来源与证据分级",
    "十六、重要声明与数据缺口",
  ],
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeLedgerItem(value: unknown, index: number): EvidenceLedgerItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const claim = typeof item.claim === "string" ? item.claim.trim() : "";
  if (!claim) return null;
  const status = VALID_STATUS.has(item.status as EvidenceStatus)
    ? (item.status as EvidenceStatus)
    : "analysis";
  const priority = item.priority === "P0" || item.priority === "P2" ? item.priority : "P1";
  const inferredClass: EvidenceClaimClass = status === "gap"
    ? "evidence_gap"
    : status === "analysis"
      ? "analysis"
      : "fact";
  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `C${index + 1}`,
    claim,
    status,
    citations: stringList(item.citations),
    investmentImpact: typeof item.investmentImpact === "string" ? item.investmentImpact.trim() : "",
    verificationAction: typeof item.verificationAction === "string" ? item.verificationAction.trim() : "",
    priority,
    claimClass: VALID_CLAIM_CLASS.has(item.claimClass as EvidenceClaimClass)
      ? item.claimClass as EvidenceClaimClass
      : inferredClass,
  };
}

export function extractEvidenceLedger(content: string): {
  items: EvidenceLedgerItem[];
  cleanContent: string;
} {
  const match = content.match(LEDGER_RE);
  const cleanContent = content.replace(LEDGER_RE, "").trim();
  if (!match) return { items: [], cleanContent };
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    return {
      items: rawItems
        .slice(0, 100)
        .map(normalizeLedgerItem)
        .filter((item): item is EvidenceLedgerItem => Boolean(item)),
      cleanContent,
    };
  } catch {
    return { items: [], cleanContent };
  }
}

function citationLocator(citation: string): string | null {
  return /^(?:M\d+·.+|E\d+)$/.test(citation) ? citation : null;
}

export function assessDeepResearchReport(input: {
  content: string;
  profile: ResolvedDeepResearchProfile;
  validCitations?: string[];
}): { ledger: EvidenceLedgerItem[]; gate: DeepResearchGate; cleanContent: string } {
  const { items: ledger, cleanContent } = extractEvidenceLedger(input.content);
  const required = REQUIRED_SECTIONS[input.profile];
  const missingSections = required.filter((heading) => !cleanContent.includes(heading));
  const valid = new Set(input.validCitations ?? []);
  const located = ledger.filter((item) => item.citations.some(citationLocator));
  const invalidCitations = valid.size === 0
    ? []
    : Array.from(new Set(ledger.flatMap((item) => item.citations)))
        .filter((citation) => citationLocator(citation) && !valid.has(citation));
  const issues: string[] = [];
  if (missingSections.length > 0) issues.push(`缺少${missingSections.length}个必备章节`);
  if (ledger.length === 0) issues.push("未生成可解析的证据底稿");
  if (ledger.some((item) => !item.investmentImpact)) issues.push("部分主张缺少投资影响");
  if (ledger.some((item) => ["gap", "inconsistent"].includes(item.status) && !item.verificationAction)) {
    issues.push("部分缺口或冲突没有验证动作");
  }
  if (ledger.some((item) => item.claimClass === "suggested_threshold" && !item.verificationAction)) {
    issues.push("部分建议验证阈值缺少适用依据或调整条件");
  }
  if (invalidCitations.length > 0) issues.push("存在无法匹配材料定位表的引用");
  if (!/\[CONFIDENCE_START\][\s\S]*?\[CONFIDENCE_END\]/.test(input.content)) {
    issues.push("缺少置信度结构块");
  }
  let status: ResearchGateStatus = "pass";
  if (missingSections.length > 0 || ledger.length === 0) status = "blocked";
  else if (issues.length > 0 || located.length < Math.ceil(ledger.length * 0.5)) status = "review";

  return {
    ledger,
    cleanContent,
    gate: {
      status,
      requiredSectionCount: required.length,
      coveredSectionCount: required.length - missingSections.length,
      sectionCoverageRate: required.length === 0 ? 1 : (required.length - missingSections.length) / required.length,
      evidenceItemCount: ledger.length,
      locatedEvidenceCount: located.length,
      locatedEvidenceRate: ledger.length === 0 ? 0 : located.length / ledger.length,
      invalidCitations,
      missingSections,
      issues,
    },
  };
}

export function buildDeepResearchMetadata(input: {
  content: string;
  profile: ResolvedDeepResearchProfile;
  validCitations?: string[];
}): DeepResearchMetadata {
  const assessed = assessDeepResearchReport(input);
  return {
    profile: input.profile,
    evidenceLedger: assessed.ledger,
    gate: assessed.gate,
    generatedAt: new Date().toISOString(),
    reviewStatus: "ai_draft",
  };
}
