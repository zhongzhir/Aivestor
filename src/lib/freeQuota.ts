import { query } from "@/lib/db";
import { formatTokens } from "@/lib/tokensFormat";

// 系统免费额度（平台代付 DeepSeek）—— 服务端专用
// 引用 pg（Node.js 专用），不要在 'use client' 组件中 import 本文件。
// 客户端需要 formatTokens 时请直接从 "@/lib/tokensFormat" 取。
//
// 设计原则：
// - user_id 粒度限额（邮箱用户无需绑定手机号即可使用免费额度）
// - SYSTEM_DEEPSEEK_API_KEY 未配置时整套机制静默禁用，不影响现有用户
// - 用户已配置自己的 Key 时完全不走免费额度路径

// 为兼容旧 import 路径，从 freeQuota 中重导出 formatTokens（仅服务端用）
export { formatTokens };

const QUOTA_LIMIT_DEFAULT = 5_000_000; // 500 万 tokens

export function getSystemApiKey(): string | null {
  return process.env.SYSTEM_DEEPSEEK_API_KEY?.trim() || null;
}

export function isSystemKeyAvailable(): boolean {
  return !!getSystemApiKey();
}

function getQuotaLimit(): number {
  const v = parseInt(process.env.FREE_QUOTA_TOKENS || "", 10);
  return Number.isFinite(v) && v > 0 ? v : QUOTA_LIMIT_DEFAULT;
}

export interface FreeQuotaStatus {
  available: boolean;
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
}

// 取当前用户的免费额度状态（以 user_id 为键，邮箱/手机号用户一视同仁）。
// 返回 null 表示：未配置系统 Key / 表不存在等无法启用的场景。
export async function getFreeQuotaStatus(
  userId: string
): Promise<FreeQuotaStatus | null> {
  if (!isSystemKeyAvailable()) return null;

  let tokensUsed = 0;
  let tokensLimit = getQuotaLimit();
  try {
    const rows = await query<{
      tokens_used: string | number;
      tokens_limit: string | number;
    }>(
      "SELECT tokens_used, tokens_limit FROM free_quota_usage WHERE user_id = $1",
      [userId]
    );
    if (rows.length > 0) {
      tokensUsed = Number(rows[0].tokens_used) || 0;
      tokensLimit = Number(rows[0].tokens_limit) || tokensLimit;
    } else {
      // 首次：插入初始行（phone 留空，邮箱用户也可享受免费额度）
      await query(
        `INSERT INTO free_quota_usage (user_id, tokens_used, tokens_limit)
         VALUES ($1, 0, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, tokensLimit]
      );
    }
  } catch (e) {
    // 表不存在（迁移未跑）等 → 静默禁用
    console.warn("[freeQuota] 查询失败，禁用免费额度:", e);
    return null;
  }

  const tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
  return {
    available: tokensUsed < tokensLimit,
    tokensUsed,
    tokensLimit,
    tokensRemaining,
  };
}

// 流式调用结束后扣减额度 + 写明细（以 user_id 为键）。失败静默忽略，不影响主流程。
export async function consumeQuota(
  userId: string,
  tokensIn: number,
  tokensOut: number,
  feature: string
): Promise<void> {
  const total = (tokensIn || 0) + (tokensOut || 0);
  if (total <= 0) return;
  try {
    await query(
      `UPDATE free_quota_usage
          SET tokens_used = tokens_used + $1, updated_at = NOW()
        WHERE user_id = $2`,
      [total, userId]
    );
    await query(
      `INSERT INTO free_quota_logs (user_id, tokens_in, tokens_out, feature)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokensIn || 0, tokensOut || 0, feature.slice(0, 50)]
    );
  } catch (e) {
    console.error("[freeQuota] consume 失败:", e);
  }
}

