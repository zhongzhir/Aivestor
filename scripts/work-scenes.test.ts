import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SKILL_SCENES, WORK_SCENES } from "@/lib/workScenes";

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

assert.equal(SKILL_SCENES.length, 7, "SKILL 常用工作应只复用已确认的七类场景");
assert.ok(SKILL_SCENES.every((scene) => scene.keywords.length > 0));

const root = process.cwd();
const projectDetail = fs.readFileSync(path.join(root, "src/components/project/ProjectDetail.tsx"), "utf8");
const reportView = fs.readFileSync(path.join(root, "src/components/project/ReportView.tsx"), "utf8");
const skillRunner = fs.readFileSync(path.join(root, "src/components/skills/SkillRunner.tsx"), "utf8");

assert.match(projectDetail, /id="ic-workspace"/);
assert.match(projectDetail, /id="project-next-action"/);
assert.match(reportView, /tab=decision&focus=ic/);
assert.match(skillRunner, /保存到项目档案/);
assert.match(skillRunner, /保存到知识库/);

console.log("work scene navigation checks passed");
