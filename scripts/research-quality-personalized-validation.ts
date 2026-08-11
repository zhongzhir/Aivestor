import { writeFileSync } from "node:fs";
import { normalizeTaskInput, generateResearchBrief, type BriefResult } from "@/lib/intelligence";
import { buildInvestorResearchContext } from "@/lib/intelligenceInvestorContext";

type ValidationCase = {
  label: string;
  userId: string;
  contextPresent: boolean;
  brief: BriefResult;
};

const taskText = "研究最近14天中国人工智能基础设施的重要资本、产品和合作变化；给出事实摘要与简要一级市场投资分析。保留与当前画像不直接匹配但可能改变市场格局的重要信号。";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; specify an authorized test user explicitly`);
  return value;
}

function inputForValidation() {
  return normalizeTaskInput({
    name: "个性化市场感知质量验收",
    topics: ["人工智能", "AI基础设施"],
    keywords: ["融资", "合作", "产品"],
    regions: ["中国"],
    includeRequirements: [taskText],
    outputInstructions: taskText,
    lookbackPeriod: { kind: "days", value: 14 },
    maxItems: 8,
    executionMode: "manual",
    scheduleConfig: null,
    isActive: true,
  });
}

async function runCase(label: string, userId: string, credentials: { provider: "deepseek"; apiKey: string; baseURL: string; model: string }): Promise<ValidationCase> {
  const context = await buildInvestorResearchContext(userId, taskText);
  const brief = await generateResearchBrief(userId, inputForValidation(), new Date(), credentials);
  return { label, userId, contextPresent: Boolean(context.trim()), brief };
}

function safeSummary(item: ValidationCase) {
  const retrieval = item.brief.metadata.retrieval;
  return {
    user: item.label,
    investorContextAvailable: item.contextPresent,
    coverage: { start: item.brief.coverageStart, end: item.brief.coverageEnd },
    completion: retrieval?.status ?? "unknown",
    facts: item.brief.importantFacts.length,
    analysisItems: item.brief.importantFacts.filter((fact) => Boolean(fact.investmentNote)).length,
    signals: item.brief.trendSignals.length,
    sourceCount: item.brief.sourceList.length,
    sourceUrls: item.brief.sourceList.map((source) => source.url),
  };
}

function reviewableBrief(brief: BriefResult) {
  return {
    taskName: brief.taskName,
    coverageStart: brief.coverageStart,
    coverageEnd: brief.coverageEnd,
    generatedAt: brief.generatedAt,
    itemCount: brief.itemCount,
    overview: brief.metadata.overview,
    completion: brief.metadata.retrieval.status,
    importantFacts: brief.importantFacts,
    trendSignals: brief.trendSignals,
    otherItems: brief.otherItems,
    sourceList: brief.sourceList,
  };
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.SYSTEM_DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or SYSTEM_DEEPSEEK_API_KEY is required for personalized quality validation");

  const credentials = { provider: "deepseek" as const, apiKey, baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" };
  const profileA = await runCase("authorized-user-a", required("RESEARCH_QUALITY_USER_A_ID"), credentials);
  const profileB = await runCase("authorized-user-b", required("RESEARCH_QUALITY_USER_B_ID"), credentials);
  const noProfile = await runCase("authorized-user-no-profile", required("RESEARCH_QUALITY_NO_PROFILE_USER_ID"), credentials);
  const results = [profileA, profileB, noProfile];

  const output = {
    generatedAt: new Date().toISOString(),
    checks: {
      sameTaskAcrossDistinctProfiles: true,
      activeProjectAndInvestorContext: [profileA, profileB].map(safeSummary),
      importantOutOfProfileSignals: "Review the saved full brief results for retained cross-market signals; no runtime filtering is applied by this validator.",
      noProfileFallback: safeSummary(noProfile),
    },
  };

  if (process.env.RESEARCH_QUALITY_OUTPUT) {
    writeFileSync(process.env.RESEARCH_QUALITY_OUTPUT, JSON.stringify({
      ...output,
      fullBriefResults: results.map(({ label, contextPresent, brief }) => ({
        user: label,
        investorContextAvailable: contextPresent,
        brief: reviewableBrief(brief),
      })),
    }, null, 2));
  }
  console.log(JSON.stringify(output));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
