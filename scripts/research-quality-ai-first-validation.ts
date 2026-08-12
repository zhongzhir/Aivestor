import { appendFileSync, writeFileSync } from "node:fs";
import { normalizeTaskInput } from "@/lib/intelligence";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";
import { hasIncompletePublicationText, hasUnsupportedComparativeAssertion, runAiFirstResearch } from "@/lib/intelligenceResearchAgent";

const cases = [
  ["行业近期动态", "研究最近7天中国创新药海外 BD 与融资动态，事实摘要后给出简要投资分析。"],
  ["单一公司", "研究最近14天月之暗面的融资、产品和合作动态，区分事实与尚待确认信息。"],
  ["多来源事件", "研究最近14天中国大模型企业融资，合并同一事件的多来源报道并保留分歧。"],
  ["时间窗口", "研究最近7天商业航天资本动态，不将窗口外旧闻或回顾文章写成新增事件。"],
  ["覆盖不足", "研究最近7天中国 AI 基础设施投资动态；若来源覆盖不足，明确说明边界并给出可核实事实。"],
] as const;
const validationStartedAt = Date.now();
let activeCase: string | null = null;

function persistFailure(rootCause: string, stoppedPhase = "bootstrap") {
  const output = { generatedAt: new Date().toISOString(), sha: process.env.GIT_COMMIT || "unknown", overallStatus: "failed", failedCase: activeCase, failureCode: rootCause, durationMs: Date.now() - validationStartedAt, stoppedPhase, qualityFailureCodes: [rootCause], completedPhases: [], rootCause };
  if (process.env.RESEARCH_QUALITY_OUTPUT) writeFileSync(process.env.RESEARCH_QUALITY_OUTPUT, JSON.stringify(output, null, 2));
  return output;
}

function selectedCases() {
  const requested = new Set((process.env.RESEARCH_QUALITY_CASES || "").split(",").map((value) => value.trim()).filter(Boolean));
  const filtered = requested.size ? cases.filter(([name]) => requested.has(name)) : [...cases];
  if (requested.size && !filtered.length) throw new Error("RESEARCH_QUALITY_CASES did not match a known validation case");
  const maxCases = Number(process.env.RESEARCH_QUALITY_MAX_CASES || filtered.length);
  return filtered.slice(0, Number.isInteger(maxCases) && maxCases > 0 ? maxCases : filtered.length);
}

async function main() {
  const allStartedAt = validationStartedAt;
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.SYSTEM_DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or SYSTEM_DEEPSEEK_API_KEY is required for ECS quality validation");
  const generationProvider = createIntelligenceGenerationProvider({ provider: "deepseek", apiKey, baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" });
  const retrieval = new IntelligenceRetrievalOrchestrator([]);
  const results: Array<Record<string, unknown>> = [];
  const eventLog = process.env.RESEARCH_QUALITY_EVENT_LOG;
  const emit = (event: object) => {
    const row = { at: new Date().toISOString(), ...event };
    if (eventLog) appendFileSync(eventLog, `${JSON.stringify(row)}\n`);
    console.log(`[research-quality] ${JSON.stringify(row)}`);
  };
  for (const [name, instruction] of selectedCases()) {
    activeCase = name;
    const startedAt = Date.now();
    emit({ phase: "case", outcome: "started", name });
    try {
      const input = normalizeTaskInput({ name, topics: ["AI", "创新药", "商业航天"], keywords: ["融资", "合作", "产品"], regions: ["中国"], includeRequirements: [instruction], outputInstructions: instruction, lookbackPeriod: { kind: "days", value: 14 }, maxItems: 8, executionMode: "manual", scheduleConfig: null, isActive: true });
      const research = await runAiFirstResearch(input, { start: new Date(Date.now() - 14 * 86400000), end: new Date() }, { generationProvider, retrieval, onEvent: emit });
      const durationMs = Date.now() - startedAt;
      const failureCode = research.research.agent?.failureCodes?.[0];
      const hasUsableResult = research.importantFacts.length + research.otherItems.length > 0 || /覆盖不足|未发现符合条件|检索未成功/.test(research.overview);
      const items = [...research.importantFacts, ...research.otherItems, ...research.trendSignals];
      const incompleteFactCount = items.filter((item) => [item.title, item.summary, item.investmentNote].filter((text): text is string => !!text).some(hasIncompletePublicationText)).length + (hasIncompletePublicationText(research.overview) ? 1 : 0);
      const facts = research.research.verifiedClaims.filter((claim) => claim.classification === "fact");
      const factWithoutBodyEvidenceCount = facts.filter((claim) => claim.evidenceStatus === "unavailable" || claim.supportingEvidence.length === 0).length;
      const unsupportedComparativeCount = facts.filter(hasUnsupportedComparativeAssertion).length;
      const sourceTierByUrl = new Map(research.sourceList.filter((source): source is typeof source & { url: string } => !!source.url).map((source) => [source.url, source.sourceTier]));
      const factsWithPrimaryEvidence = facts.filter((claim) => claim.supportingEvidence.some((evidence) => sourceTierByUrl.get(evidence.url) === "S")).length;
      const independentSourceCount = new Set(research.sourceList.map((source) => source.url ? new URL(source.url).hostname.replace(/^www\./, "") : "").filter(Boolean)).size;
      const clueRestatedAsFact = research.research.verifiedClaims.filter((claim) => claim.classification === "clue").some((claim) => research.overview.includes(claim.statement) && !/待核实|据报道|若获确认/.test(research.overview));
      const qualityFailureCodes = [
        ...(incompleteFactCount ? ["INCOMPLETE_PUBLICATION_TEXT"] : []),
        ...(factWithoutBodyEvidenceCount ? ["FACT_WITHOUT_BODY_EVIDENCE"] : []),
        ...(unsupportedComparativeCount ? ["UNSUPPORTED_COMPARATIVE_ASSERTION"] : []),
        ...(clueRestatedAsFact ? ["CLUE_RESTATED_AS_FACT"] : []),
        ...(durationMs > 480000 ? ["CASE_DURATION_EXCEEDED"] : []),
      ];
      const quality = {
        incompleteFactCount, factWithoutBodyEvidenceCount, unsupportedComparativeCount, factsWithPrimaryEvidence,
        independentSourceCount, evidenceReadAttempted: research.retrieval.evidence.attempted, evidenceReadFull: research.retrieval.evidence.full,
        evidenceReadPartial: research.retrieval.evidence.partial, evidenceReadUnavailable: research.retrieval.evidence.unavailable,
        durationMs, qualityFailureCodes,
      };
      if (research.retrieval.status === "failed" || failureCode?.includes("timeout") || failureCode?.includes("FINALIZATION") || !hasUsableResult || qualityFailureCodes.length) {
        throw new Error(qualityFailureCodes[0] || failureCode || (research.retrieval.status === "failed" ? "retrieval_failed" : "no_usable_result"));
      }
      results.push({ name, status: "completed", durationMs, retrieval: research.retrieval.status, overview: research.overview, facts: research.importantFacts.map((item) => ({ title: item.title, urls: item.sourceUrls, eventDate: item.publishedAt })), clues: research.otherItems.map((item) => ({ title: item.title, urls: item.sourceUrls })), analysis: research.importantFacts.map((item) => item.investmentNote).filter(Boolean), evidence: research.retrieval.evidence, quality });
      emit({ phase: "research", outcome: "completed", name, durationMs, counts: { facts: research.importantFacts.length, clues: research.otherItems.length, sources: research.sourceList.length } });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : "unknown_error";
      const output = { generatedAt: new Date().toISOString(), sha: process.env.GIT_COMMIT || "unknown", overallStatus: "failed", failedCase: name, failureCode: reason, durationMs: Date.now() - allStartedAt, stoppedPhase: "research", qualityFailureCodes: [reason], completedPhases: results.map((result) => result.name), rootCause: reason, cases: [...results, { name, status: "failed", durationMs, reason }] };
      if (process.env.RESEARCH_QUALITY_OUTPUT) writeFileSync(process.env.RESEARCH_QUALITY_OUTPUT, JSON.stringify(output, null, 2));
      emit({ phase: "research", outcome: "failed", name, durationMs, failureCode: reason });
      console.error(JSON.stringify(output));
      process.exitCode = 1;
      return;
    }
  }
  const output = { generatedAt: new Date().toISOString(), sha: process.env.GIT_COMMIT || "unknown", overallStatus: "passed", failedCase: null, failureCode: null, durationMs: Date.now() - allStartedAt, cases: results };
  if (process.env.RESEARCH_QUALITY_OUTPUT) writeFileSync(process.env.RESEARCH_QUALITY_OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((error) => { const rootCause = error instanceof Error ? error.message : "unknown_error"; console.error(JSON.stringify(persistFailure(rootCause))); process.exitCode = 1; });
