import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProjectLabel, projectScope, validateProjectLabel } from "@/lib/projectManagement";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("db/migrations/043_project_management_tools.sql");
const managementRoute = read("src/app/api/projects/[id]/management/route.ts");
const categoryRoute = read("src/app/api/project-categories/route.ts") + read("src/app/api/project-categories/[id]/route.ts");
const projectsPage = read("src/app/(app)/projects/page.tsx");
const archivePage = read("src/app/(app)/archive/page.tsx");
const projectPanel = read("src/components/project/ProjectManagementPanel.tsx");

assert.match(migration, /category_id UUID REFERENCES project_categories/);
assert.match(migration, /is_priority BOOLEAN NOT NULL DEFAULT false/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS project_tag_links/);
assert.match(migration, /ON DELETE SET NULL/);
assert.match(migration, /uq_project_tags_(user|org)_name/);
assert.match(projectsPage, /scopedProjectWhere/);
assert.match(archivePage, /scopedProjectWhere/);
assert.match(projectsPage, /priority_desc/);
assert.match(archivePage, /priority_desc/);
assert.match(projectsPage, /project_tag_links/);
assert.match(archivePage, /project_tag_links/);
assert.match(managementRoute, /assertProjectAccess\(scope, id, action\)/);
assert.match(managementRoute, /ON CONFLICT \(project_id, tag_id\) DO NOTHING/);
assert.match(categoryRoute, /assertProjectAccess/);
assert.match(projectPanel, /仅看重点|重点项目/);
assert.match(projectPanel, /输入标签，回车添加/);

assert.equal(normalizeProjectLabel("  AI　 "), "ai");
assert.equal(normalizeProjectLabel("北京"), normalizeProjectLabel("北京"));
assert.deepEqual(validateProjectLabel(" 待初筛 ", "分类"), { value: "待初筛", normalized: "待初筛" });
const invalidTag = validateProjectLabel("", "标签");
assert.equal("error" in invalidTag ? invalidTag.error : "", "请输入标签名称");
assert.equal(projectScope({ userId: "u", org: { orgId: "o" } } as never, { org_id: null }).org, null);
assert.equal(projectScope({ userId: "u", org: { orgId: "o" } } as never, { org_id: "o" }).org?.orgId, "o");

console.log("project-management tests passed");
