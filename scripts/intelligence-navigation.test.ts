import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const root = process.cwd();
const layout = read(`${root}/src/app/(app)/layout.tsx`);
const sidebar = read(`${root}/src/components/Sidebar.tsx`);
const dataApps = read(`${root}/src/app/(app)/data-apps/page.tsx`);
const appPage = read(`${root}/src/app/(app)/data-apps/[appId]/page.tsx`);

assert.match(layout, /getOrgContext/);
assert.match(layout, /<Sidebar hasOrganization=\{!!orgContext\} \/>/);
assert.match(sidebar, /href: "\/data-apps\/intelligence-subscriptions"/);
assert.match(sidebar, /hasOrganization/);
assert.doesNotMatch(sidebar, /session\.user\.orgId/);
assert.match(dataApps, /const accessibleApps = DATA_APPS\.filter/);
assert.match(dataApps, /app\.availableToPersonal === true/);
assert.match(dataApps, /accessibleApps\.length === 0/);
assert.doesNotMatch(dataApps, /机构数据能力暂未开通/);
assert.match(appPage, /app\.availableToPersonal === true/);
console.log("intelligence navigation tests passed");
