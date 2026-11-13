import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  recommendProjectAnalysis,
  type ProjectAnalysisContext,
} from "@/lib/projectAnalysisPresentation";
import { intelligenceFormVisibility } from "@/lib/intelligenceFormVisibility";
import { partitionAttentionProjects } from "@/lib/dashboardAttention";

const recommendation = (overrides: Partial<ProjectAnalysisContext> = {}) =>
  recommendProjectAnalysis({
    processStage: "screening",
    hasReportContextDoc: false,
    judgmentPointCount: 0,
    deepResearchBetaEnabled: false,
    ...overrides,
  });

assert.equal(recommendation(), "prepare");
assert.equal(
  recommendation({ hasReportContextDoc: false, judgmentPointCount: 3 }),
  "prepare",
  "standard analysis must not be recommended before a parsed document exists"
);

const attention = partitionAttentionProjects([1, 2, 3, 4, 5, 6, 7, 8]);
assert.deepEqual(attention.primary, [1, 2, 3]);
assert.deepEqual(attention.remaining, [4, 5, 6, 7, 8]);
assert.equal(attention.total, 8);
assert.equal(
  recommendation({ hasReportContextDoc: true, judgmentPointCount: 0 }),
  "brief"
);
assert.equal(
  recommendation({ hasReportContextDoc: true, judgmentPointCount: 2 }),
  "brief"
);
assert.equal(
  recommendation({ hasReportContextDoc: true, judgmentPointCount: 3 }),
  "analysis"
);
assert.equal(
  recommendation({ hasReportContextDoc: true, judgmentPointCount: 10 }),
  "analysis"
);
assert.equal(
  recommendation({
    processStage: "due_diligence",
    hasReportContextDoc: true,
    judgmentPointCount: 3,
    deepResearchBetaEnabled: true,
  }),
  "deep_research"
);
assert.equal(
  recommendation({
    processStage: "due_diligence",
    hasReportContextDoc: true,
    judgmentPointCount: 3,
    deepResearchBetaEnabled: false,
  }),
  "analysis",
  "Beta permissions must continue to gate the deep research recommendation"
);
assert.equal(
  recommendation({ hasReportContextDoc: true, judgmentPointCount: 11 }),
  "refine",
  "more than 10 points requires refinement instead of an incorrect insufficient-points message"
);

assert.deepEqual(
  intelligenceFormVisibility({
    lookbackKind: "3",
    executionMode: "manual",
    frequency: "weekly",
  }),
  { showCustomRange: false, showSchedule: false, showWeekday: false }
);
assert.deepEqual(
  intelligenceFormVisibility({
    lookbackKind: "custom",
    executionMode: "manual",
    frequency: "weekly",
  }),
  { showCustomRange: true, showSchedule: false, showWeekday: false }
);
assert.deepEqual(
  intelligenceFormVisibility({
    lookbackKind: "7",
    executionMode: "scheduled",
    frequency: "daily",
  }),
  { showCustomRange: false, showSchedule: true, showWeekday: false }
);
assert.deepEqual(
  intelligenceFormVisibility({
    lookbackKind: "7",
    executionMode: "scheduled",
    frequency: "weekly",
  }),
  { showCustomRange: false, showSchedule: true, showWeekday: true }
);

const root = process.cwd();
const dashboard = fs.readFileSync(path.join(root, "src/app/(app)/dashboard/page.tsx"), "utf8");
const workScenes = fs.readFileSync(path.join(root, "src/components/dashboard/WorkSceneCards.tsx"), "utf8");
const projectDetail = fs.readFileSync(path.join(root, "src/components/project/ProjectDetail.tsx"), "utf8");

assert.match(dashboard, /今日优先事项/);
assert.match(dashboard, /attentionPresentation\.primary/);
assert.doesNotMatch(dashboard, /\.filter\(\(p\): p is AttentionProject => p\.days !== null\)\s*\.slice\(0, 4\)/);
assert.match(dashboard, /查看项目管线/);
assert.match(workScenes, /<details/);
assert.match(workScenes, /展开 6 个场景/);
assert.match(projectDetail, /analysis-recommendation/);
assert.match(projectDetail, /查看其他分析方式/);
assert.match(projectDetail, /专项工具与其他输出/);
assert.match(projectDetail, /3-10 条核心判断要点/);
assert.doesNotMatch(projectDetail, /3-10 个.*问题/);

console.log("mainline UX presentation checks passed");
