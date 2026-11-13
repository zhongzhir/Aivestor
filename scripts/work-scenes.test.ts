import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  QUICK_WORK_SCENE_IDS,
  QUICK_WORK_SCENES,
  SKILL_SCENES,
  WORK_SCENES,
} from "@/lib/workScenes";
import {
  MOBILE_PRIMARY_NAV,
  isPrimaryNavigationActive,
} from "@/lib/primaryNavigation";
import {
  buildWorkIntentHref,
  classifyWorkIntent,
  WORK_INTENTS,
} from "@/lib/workIntent";

assert.equal(WORK_SCENES.length, 6, "工作台应保持六个高频场景，不继续扩张");
assert.equal(new Set(WORK_SCENES.map((scene) => scene.id)).size, WORK_SCENES.length);
assert.ok(WORK_SCENES.every((scene) => scene.href.startsWith("/")));
assert.deepEqual(
  WORK_SCENES.map((scene) => scene.id),
  [
    "company-analysis",
    "batch-screening",
    "industry-research",
    "due-diligence",
    "ic-preparation",
    "intelligence",
  ]
);

assert.deepEqual(
  QUICK_WORK_SCENES.map((scene) => scene.id),
  [...QUICK_WORK_SCENE_IDS],
  "工作台首屏只保留三个真实高频入口，其余场景继续渐进展开"
);

assert.deepEqual(
  MOBILE_PRIMARY_NAV.map((item) => item.href),
  [
    "/dashboard",
    "/projects",
    "/data-apps/intelligence-subscriptions",
    "/settings",
  ]
);
assert.equal(isPrimaryNavigationActive("/projects/demo", "/projects"), true);
assert.equal(isPrimaryNavigationActive("/archive/demo", "/projects"), false);
assert.equal(isPrimaryNavigationActive("/dashboard", "/dashboard"), true);

assert.equal(SKILL_SCENES.length, 7, "SKILL 常用工作应只复用已确认的七类场景");
assert.ok(SKILL_SCENES.every((scene) => scene.keywords.length > 0));

assert.equal(WORK_INTENTS.length, 6, "统一任务入口必须覆盖六条已确认流程");
assert.equal(classifyWorkIntent("批量初筛这 12 份 BP"), "batch-screening");
assert.equal(classifyWorkIntent("准备云合智能投委会 IC 材料"), "ic-preparation");
assert.equal(classifyWorkIntent("形成创始人访谈和尽调问题清单"), "due-diligence");
assert.equal(classifyWorkIntent("每周跟踪机器人公司融资动态"), "intelligence");
assert.equal(classifyWorkIntent("研究低空经济竞争格局"), "industry-research");
assert.equal(classifyWorkIntent("分析云合智能商业计划书"), "company-analysis");
assert.match(buildWorkIntentHref("company-analysis", "分析项目"), /^\/projects\/new\?brief=/);
assert.match(buildWorkIntentHref("intelligence", "每周跟踪"), /new=1/);

const root = process.cwd();
const projectDetail = fs.readFileSync(path.join(root, "src/components/project/ProjectDetail.tsx"), "utf8");
const reportView = fs.readFileSync(path.join(root, "src/components/project/ReportView.tsx"), "utf8");
const skillRunner = fs.readFileSync(path.join(root, "src/components/skills/SkillRunner.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/components/AppShell.tsx"), "utf8");
const mobileBottomNav = fs.readFileSync(path.join(root, "src/components/MobileBottomNav.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "src/app/(app)/dashboard/page.tsx"), "utf8");
const projectsPage = fs.readFileSync(path.join(root, "src/app/(app)/projects/page.tsx"), "utf8");
const projectFilters = fs.readFileSync(path.join(root, "src/app/(app)/projects/ProjectFilters.tsx"), "utf8");
const projectMobileCard = fs.readFileSync(path.join(root, "src/components/project/ProjectMobileCard.tsx"), "utf8");
const unifiedTaskLauncher = fs.readFileSync(path.join(root, "src/components/dashboard/UnifiedTaskLauncher.tsx"), "utf8");
const fileUploader = fs.readFileSync(path.join(root, "src/components/shared/FileUploader.tsx"), "utf8");
const deepResearchPanel = fs.readFileSync(path.join(root, "src/components/project/DeepResearchJobPanel.tsx"), "utf8");
const projectApi = fs.readFileSync(path.join(root, "src/app/api/projects/route.ts"), "utf8");

assert.match(projectDetail, /id="ic-workspace"/);
assert.match(projectDetail, /id="project-next-action"/);
assert.match(reportView, /tab=decision&focus=ic/);
assert.match(skillRunner, /保存到项目档案/);
assert.match(skillRunner, /保存到知识库/);
assert.match(appShell, /MobileBottomNav/);
assert.match(appShell, /pb-20 md:pb-0/);
assert.match(mobileBottomNav, /移动端主导航/);
assert.match(mobileBottomNav, /md:hidden/);
assert.match(dashboard, /QuickWorkLauncher/);
assert.match(projectsPage, /ProjectMobileCard/);
assert.match(projectsPage, /p\.next_action/);
assert.match(projectMobileCard, /下一步/);
assert.match(projectMobileCard, /project\.next_action/);
assert.match(projectFilters, /project-advanced-filters/);
assert.match(projectFilters, /aria-expanded=\{filtersOpen\}/);
assert.match(projectDetail, /role="tablist"/);
assert.match(projectDetail, /sticky top-0/);
assert.match(projectDetail, /ResponsiveDisclosure/);
assert.match(projectDetail, /材料与证据/);
assert.match(projectDetail, /分析与报告/);
assert.match(projectDetail, /SourceDrawer/);
assert.match(projectDetail, /保存为项目下一步/);
assert.match(unifiedTaskLauncher, /带着任务继续/);
assert.match(unifiedTaskLauncher, /classifyWorkIntent/);
assert.match(fileUploader, /onUploadComplete\?\.\(\[/);
assert.match(deepResearchPanel, /aria-live="polite"/);
assert.match(projectApi, /workspace_note/);

console.log("work scene navigation checks passed");
