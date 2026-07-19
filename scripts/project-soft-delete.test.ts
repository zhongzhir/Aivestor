import assert from "assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (path: string) => readFileSync(resolve(path), "utf8");

const migration = read("db/migrations/042_project_soft_delete.sql");
const access = read("src/lib/resourceAccess.ts");
const deleteRoute = read("src/app/api/projects/[id]/route.ts");
const archivePage = read("src/app/(app)/archive/page.tsx");
const archiveActions = read(
  "src/components/archive/ArchiveProjectActions.tsx"
);

assert.match(migration, /ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS deleted_by UUID/);
assert.match(migration, /WHERE deleted_at IS NULL/);

assert.match(
  access,
  /WHERE id = \$1 AND deleted_at IS NULL/,
  "all project access checks must treat deleted projects as missing"
);
assert.match(
  access,
  /if \(action === "delete"\)[\s\S]*role === "admin"/,
  "organization project deletion must be admin-only"
);
assert.doesNotMatch(
  access,
  /action === "delete"[^\n]*role === "partner"/,
  "partners must not retain a project deletion path"
);

assert.match(deleteRoute, /assertProjectAccess\(scope, params\.id, "delete"\)/);
assert.match(deleteRoute, /SET deleted_at = NOW\(\), deleted_by = \$2/);
assert.doesNotMatch(deleteRoute, /DELETE\s+FROM\s+projects/i);

assert.match(archivePage, /p\.deleted_at IS NULL/);
assert.match(archivePage, /ctx\.role === "admin"/);
assert.match(archivePage, /<ArchiveProjectActions/);
assert.match(archiveActions, /method: "DELETE"/);
assert.match(archiveActions, /删除后将不再显示/);

console.log("project soft-delete tests passed");
