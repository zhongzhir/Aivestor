// src/lib/dataAppRateLimit.ts —— 机构点查频控（架构文档 v1.1 第 6.3 节）
//
// 内存滑动窗口计数（单 ECS 低并发足够，不引入 Redis）：同一用户 60 次/小时，
// 超出返回 true（应回 429）。多实例部署时各实例独立计数——点查是只读防穷举手段
// 而非安全边界，宽松些可接受。进程重启自然清零。

const WINDOW_MS = 60 * 60 * 1000; // 1 小时
const MAX_PER_WINDOW = 60;

// userId → 窗口内的请求时间戳列表
const hits = new Map<string, number[]>();

// 记录一次点查并判断是否超限。返回 { limited, remaining }。
export function consumeLookupQuota(userId: string): {
  limited: boolean;
  remaining: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const list = (hits.get(userId) ?? []).filter((t) => t > cutoff);

  if (list.length >= MAX_PER_WINDOW) {
    hits.set(userId, list); // 写回已裁剪的窗口
    return { limited: true, remaining: 0 };
  }

  list.push(now);
  hits.set(userId, list);

  // 顺带做一次惰性清理，避免长期累积空闲用户的空数组
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= cutoff)) hits.delete(k);
    }
  }

  return { limited: false, remaining: MAX_PER_WINDOW - list.length };
}
