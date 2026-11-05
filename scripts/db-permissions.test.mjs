import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGrantStatements, parseDatabaseUser } from "./grant-app-db-permissions.mjs";
import { REQUIRED_COLUMNS, REQUIRED_TABLES, validateSchemaSnapshot } from "./check-production-schema.mjs";

assert.equal(parseDatabaseUser("postgresql://app%2Duser:secret@example.com/app"), "app-user");
const grants = buildGrantStatements("app-user", ["intelligence_tasks"], ["intelligence_tasks_id_seq"]);
assert.deepEqual(grants, buildGrantStatements("app-user", ["intelligence_tasks"], ["intelligence_tasks_id_seq"]), "重复执行应产生相同幂等授权语句");
assert.match(grants.join("\n"), /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.\"intelligence_tasks\" TO \"app-user\"/);
assert.match(grants.join("\n"), /GRANT USAGE, SELECT ON SEQUENCE/);
assert.equal(grants.join("\n").includes("OWNER"), false);
assert.equal(grants.join("\n").includes("SUPERUSER"), false);
const sourceItemGrants = buildGrantStatements("app-user", ["intelligence_source_items"], []);
assert.match(sourceItemGrants.join("\n"), /GRANT SELECT ON TABLE public\."intelligence_source_items" TO "app-user"/);
assert.doesNotMatch(sourceItemGrants.join("\n"), /INSERT|UPDATE|DELETE/);

const complete = {
  schemaUsage: true,
  tables: REQUIRED_TABLES,
  columns: REQUIRED_COLUMNS,
  // 模拟 node-postgres 对 SELECT ... AS select 的真实返回键格式。
  tablePrivileges: Object.fromEntries(REQUIRED_TABLES.map((table) => [table, { select: true, insert: true, update: true, delete: true }])),
};
assert.deepEqual(validateSchemaSnapshot(complete), []);
assert.match(validateSchemaSnapshot({ ...complete, tables: complete.tables.filter((table) => table !== "intelligence_feedback") })[0], /intelligence_feedback/);
assert.match(validateSchemaSnapshot({ ...complete, columns: complete.columns.filter(({ table }) => table !== "intelligence_run_checkpoints") })[0], /intelligence_run_checkpoints/);
assert.match(validateSchemaSnapshot({ ...complete, schemaUsage: false })[0], /schema public/);
assert.match(validateSchemaSnapshot({ ...complete, tablePrivileges: { ...complete.tablePrivileges, intelligence_tasks: { select: true, insert: false, update: true, delete: true } } })[0], /intelligence_tasks.*INSERT/);

for (const file of ["scripts/grant-app-db-permissions.ps1", "scripts/check-production-schema.ps1"]) {
  assert.ok(readFileSync(join(process.cwd(), file), "utf8").includes("node"), `${file} should delegate to Node implementation`);
}
console.log("database permission tests passed");
