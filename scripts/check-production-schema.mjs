import pg from "pg";

export const REQUIRED_TABLES = [
  "user_profiles",
  "project_categories",
  "project_tags",
  "project_tag_links",
  "intelligence_tasks",
  "intelligence_briefs",
  "intelligence_feedback",
];

export const REQUIRED_COLUMNS = [
  { table: "user_profiles", column: "screening_criteria" },
];

export const REQUIRED_TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];

export function validateSchemaSnapshot(snapshot) {
  const errors = [];
  if (!snapshot.schemaUsage) errors.push("schema public: USAGE 权限缺失");
  for (const table of REQUIRED_TABLES) {
    if (!snapshot.tables.includes(table)) {
      errors.push(`表 public.${table} 不存在`);
      continue;
    }
    const privileges = snapshot.tablePrivileges[table] ?? {};
    for (const privilege of REQUIRED_TABLE_PRIVILEGES) {
      if (privileges[privilege] !== true) errors.push(`表 public.${table}: ${privilege} 权限缺失`);
    }
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!snapshot.columns.some((item) => item.table === required.table && item.column === required.column)) {
      errors.push(`字段 public.${required.table}.${required.column} 不存在`);
    }
  }
  return errors;
}

async function loadSchemaSnapshot(client, role) {
  const tables = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')`
  );
  const columns = await client.query(
    `SELECT table_name AS table, column_name AS column
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'user_profiles' AND column_name = 'screening_criteria'))`
  );
  const schema = await client.query("SELECT has_schema_privilege($1, 'public', 'USAGE') AS allowed", [role]);
  const tablePrivileges = {};
  const presentTables = new Set(tables.rows.map((row) => row.name));
  for (const table of REQUIRED_TABLES) {
    if (!presentTables.has(table)) {
      tablePrivileges[table] = {};
      continue;
    }
    const result = await client.query(
      `SELECT
         has_table_privilege($1, $2, 'SELECT') AS select,
         has_table_privilege($1, $2, 'INSERT') AS insert,
         has_table_privilege($1, $2, 'UPDATE') AS update,
         has_table_privilege($1, $2, 'DELETE') AS delete`,
      [role, `public.${table}`]
    );
    tablePrivileges[table] = result.rows[0] ?? {};
  }
  return {
    tables: tables.rows.map((row) => row.name),
    columns: columns.rows,
    schemaUsage: schema.rows[0]?.allowed === true,
    tablePrivileges,
  };
}

export async function checkProductionSchema(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error("DATABASE_URL 不是有效的 PostgreSQL 连接串"); }
  const role = decodeURIComponent(url.username || "");
  if (!role) throw new Error("DATABASE_URL 缺少应用数据库用户名");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return { role, errors: validateSchemaSnapshot(await loadSchemaSnapshot(client, role)) };
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("未设置 DATABASE_URL 环境变量");
  const result = await checkProductionSchema(connectionString);
  console.log(`检查应用数据库账号：${result.role}`);
  if (result.errors.length > 0) {
    console.error("生产 schema 检查失败：");
    result.errors.forEach((error) => console.error(`  - ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log("生产 schema、字段和应用账号必要权限检查通过");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    console.error(`schema 检查失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
