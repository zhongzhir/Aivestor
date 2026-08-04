import pg from "pg";

export function parseDatabaseUser(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL 不是有效的 PostgreSQL 连接串");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username) {
    throw new Error("DATABASE_URL 缺少应用数据库用户名");
  }
  return decodeURIComponent(url.username);
}

export function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function buildGrantStatements(role, tables, sequences) {
  const roleIdentifier = quoteIdentifier(role);
  return [
    `GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`,
    ...tables.map((name) => `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quoteIdentifier(name)} TO ${roleIdentifier}`),
    ...sequences.map((name) => `GRANT USAGE, SELECT ON SEQUENCE public.${quoteIdentifier(name)} TO ${roleIdentifier}`),
  ];
}

async function loadPublicObjects(client) {
  const tables = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'f')
        AND c.relname NOT LIKE 'pg_%'
      ORDER BY c.relname`
  );
  const sequences = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'S'
        AND c.relname NOT LIKE 'pg_%'
      ORDER BY c.relname`
  );
  return {
    tables: tables.rows.map((row) => row.name),
    sequences: sequences.rows.map((row) => row.name),
  };
}

export async function grantAppDatabasePermissions(connectionString, { dryRun = false } = {}) {
  const role = parseDatabaseUser(connectionString);
  if (dryRun) {
    return { role, statements: buildGrantStatements(role, ["<public tables>"], ["<public sequences>"]) };
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const objects = await loadPublicObjects(client);
    const statements = buildGrantStatements(role, objects.tables, objects.sequences);
    for (const statement of statements) await client.query(statement);
    return { role, tables: objects.tables, sequences: objects.sequences, statements };
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("未设置 DATABASE_URL 环境变量");
  const dryRun = process.argv.includes("--dry-run");
  const result = await grantAppDatabasePermissions(connectionString, { dryRun });
  console.log(`应用数据库账号：${result.role}`);
  if (dryRun) {
    console.log("[dry-run] 不连接数据库，授权语句模板：");
    result.statements.forEach((statement) => console.log(`  ${statement}`));
    return;
  }
  console.log(`已处理 public schema：${result.tables.length} 个表，${result.sequences.length} 个序列`);
  console.log("授权完成（不修改 owner，不授予超级权限）");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    console.error(`授权失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
