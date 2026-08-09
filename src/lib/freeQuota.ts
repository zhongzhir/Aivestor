import { query } from "@/lib/db";
import { formatTokens } from "@/lib/tokensFormat";

// 系统免费额度（平台代付通用 AI）—— 服务端专用
// 引用 pg（Node.js 专用），不要在 'use client' 组件中 import 本文件。
// 客户端需要 formatTokens 时请直接从 "@/lib/tokensFormat" 取。
//
// 设计原则：
// - user_id 粒度限额（邮箱用户无需绑定手机号即可使用免费额度）
// - 未配置系统 AI Key（SYSTEM_AI_API_KEY / 旧 DeepSeek Key）时整套机制静默禁用
// - 用户已配置自己的 Key 时完全不走免费额度路径

// 为兼容旧 import 路径，从 freeQuota 中重导出 formatTokens（仅服务端用）
export { formatTokens };

const QUOTA_LIMIT_DEFAULT = 5_000_000; // 500 万 tokens（绑定手机号后的完整额度）

// F-15 方向A：免费额度按手机绑定状态分层。
export const TRIAL_QUOTA_LIMIT = 5_000_000; // 默认每位用户 500 万 tokens
export const LEGACY_BIND_BONUS = 500_000; // 存量未绑定用户绑定后一次性追加额度

export function getSystemApiKey(): string | null {
  // 新配置优先；保留旧 SYSTEM_DEEPSEEK_API_KEY，确保历史部署向后兼容。
  return (
    process.env.SYSTEM_AI_API_KEY?.trim() ||
    process.env.SYSTEM_DEEPSEEK_API_KEY?.trim() ||
    null
  );
}

export function getSystemAIProvider(): string {
  const configured = process.env.SYSTEM_AI_PROVIDER?.trim().toLowerCase();
  if (configured) return configured;

  return "deepseek";
}

export function getSystemAIModel(): string | undefined {
  return process.env.SYSTEM_AI_MODEL?.trim() || undefined;
}

export function getSystemAIBaseURL(): string | undefined {
  const configured = process.env.SYSTEM_AI_BASE_URL?.trim();
  if (configured) return configured;

  return getSystemAIProvider() === "qwen"
    ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
    : "https://api.deepseek.com/v1";
}

export function isSystemKeyAvailable(): boolean {
  return !!getSystemApiKey();
}

function getQuotaLimit(): number {
  const v = parseInt(process.env.FREE_QUOTA_TOKENS || "", 10);
  return Number.isFinite(v) && v > 0 ? v : QUOTA_LIMIT_DEFAULT;
}

// 绑定手机号后的完整额度上限（env 可覆盖，与首次创建逻辑一致）。供绑定接口复用。
export function getFullQuotaLimit(): number {
  return getQuotaLimit();
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
      // 首次创建：按手机绑定状态分层额度（F-15 方向A）。
      // 未绑定手机号 → 试用额度；已绑定 → 完整额度（维持现状）。
      // 仅影响本次改动上线后新建的行；已存在行的 tokens_limit 不回溯修改。
      const userRows = await query<{ phone: string | null }>(
        "SELECT phone FROM users WHERE id = $1",
        [userId]
      );
      const hasPhone = !!userRows[0]?.phone;
      tokensLimit = hasPhone ? getQuotaLimit() : TRIAL_QUOTA_LIMIT;
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

// 为不真正调用平台模型的既有生成流程预留一次固定额度；成功后记录为一次功能消耗。
// 自有 API 不经过此函数。
export async function reserveQuota(
  userId: string,
  tokens: number,
  feature: string
): Promise<boolean> {
  const amount = Math.max(0, Math.floor(tokens));
  if (amount === 0) return true;
  try {
    const rows = await query<{ user_id: string }>(
      `UPDATE free_quota_usage
          SET tokens_used = tokens_used + $1, updated_at = NOW()
        WHERE user_id = $2 AND tokens_used + $1 <= tokens_limit
        RETURNING user_id`,
      [amount, userId]
    );
    if (!rows[0]) return false;
    await query(
      `INSERT INTO free_quota_logs (user_id, tokens_in, tokens_out, feature)
       VALUES ($1, $2, 0, $3)`,
      [userId, amount, feature.slice(0, 50)]
    );
    return true;
  } catch (e) {
    console.error("[freeQuota] reserve 失败:", e);
    return false;
  }
}

