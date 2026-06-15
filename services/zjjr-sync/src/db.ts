// 同步服务专用数据库连接（独立于主应用 src/lib/db.ts）。
//
// 隔离红线（5.2）：本服务连接【专用账号 zjjr_sync】，对 zjjr_* 表全权限、对业务表
//   零权限。连接串从 ZJJR_SYNC_DATABASE_URL 读取；为便于本地 smoke-test，未配置时
//   回退到 DATABASE_URL（本地单账号场景）——生产环境务必显式配置专用账号串。

import { Pool, type PoolClient } from "pg";

const connectionString =
  process.env.ZJJR_SYNC_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "缺少数据库连接串：请设置 ZJJR_SYNC_DATABASE_URL（生产，专用账号）" +
      "或 DATABASE_URL（本地 smoke-test）"
  );
}

export const pool = new Pool({
  connectionString,
  max: 4,
  idleTimeoutMillis: 30_000,
});

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

// 事务辅助：双轨写入（write.ts）的受影响实体先删后插需在同一事务内。
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
