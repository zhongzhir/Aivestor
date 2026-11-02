export type ProjectAnalysisRecommendation =
  | "prepare"
  | "brief"
  | "analysis"
  | "refine"
  | "deep_research";

export interface ProjectAnalysisContext {
  processStage: string;
  hasReportContextDoc: boolean;
  judgmentPointCount: number;
  deepResearchBetaEnabled: boolean;
}

/**
 * This only chooses the most useful entry to emphasize. It never changes
 * permissions, report kinds, routes, or the availability of other tools.
 */
export function recommendProjectAnalysis({
  processStage,
  hasReportContextDoc,
  judgmentPointCount,
  deepResearchBetaEnabled,
}: ProjectAnalysisContext): ProjectAnalysisRecommendation {
  if (!hasReportContextDoc) {
    return "prepare";
  }

  const formalResearchStage =
    processStage === "due_diligence" ||
    processStage === "investment_committee";

  if (deepResearchBetaEnabled && hasReportContextDoc && formalResearchStage) {
    return "deep_research";
  }
  if (judgmentPointCount >= 3 && judgmentPointCount <= 10) {
    return "analysis";
  }
  return judgmentPointCount > 10 ? "refine" : "brief";
}
