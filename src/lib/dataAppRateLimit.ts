// src/lib/dataAppRateLimit.ts —— 机构点查频控（架构文档 v1.1 第 6.3 节）
//
// DB 计数滑动窗口（审计修复 F-02）：每次点查 INSERT 一行日志，再按 user_id 与
// ip_address 分别统计最近 1 小时行数，任一超过上限即拒绝（复合 key 取更严格者）。
// 相比原进程内 Map：PM2 多实例共享计数、进程重启不清零、多账号无法单维度放大。

import { query } from "@/lib/db";

const MAX_PER_WINDOW = 60; // 每小时上限（user_id 与 ip 各自）

// 从请求头解析真实客户端 IP。经 Nginx 反代时取 X-Forwarded-For 第一段
// （client, proxy1, ...），避免读到反代自身内网 IP。
export function clientIpFrom(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// 记录一次点查并判断是否超限。返回 { limited, remaining }。
export async function consumeLookupQuota(
  userId: string,
  ipAddress: string
): Promise<{ limited: boolean; remaining: number }> {
  // 先记录本次点查（即便随后判定超限，也照常入账，窗口计数更保守）。
  await query(
    "INSERT INTO institution_lookup_logs (user_id, ip_address) VALUES ($1, $2)",
    [userId, ipAddress]
  );

  // 分别统计最近 1 小时内 user_id / ip 维度的行数（含本次）。
  const rows = await query<{ user_count: string; ip_count: string }>(
    `SELECT
        COUNT(*) FILTER (WHERE user_id = $1) AS user_count,
        COUNT(*) FILTER (WHERE ip_address = $2) AS ip_count
       FROM institution_lookup_logs
      WHERE created_at > now() - INTERVAL '1 hour'
        AND (user_id = $1 OR ip_address = $2)`,
    [userId, ipAddress]
  );

  const userCount = Number(rows[0]?.user_count ?? 0);
  const ipCount = Number(rows[0]?.ip_count ?? 0);
  const maxCount = Math.max(userCount, ipCount);

  // 任一维度超过上限即限流（取更严格者）。
  const limited = maxCount > MAX_PER_WINDOW;
  return { limited, remaining: Math.max(0, MAX_PER_WINDOW - maxCount) };
}
