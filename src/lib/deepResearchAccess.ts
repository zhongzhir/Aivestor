import { query } from "@/lib/db";

export function isDeepResearchBetaWhitelisted(
  userId: string,
  configured = process.env.DEEP_RESEARCH_BETA_USER_IDS || ""
): boolean {
  const ids = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.includes("*") || ids.includes(userId);
}

/**
 * Beta 默认只开放平台管理员；可用逗号分隔的用户 UUID 增加测试账号。
 * 未配置环境变量时不会意外全量开放。
 */
export async function canUseDeepResearchBeta(userId: string): Promise<boolean> {
  if (isDeepResearchBetaWhitelisted(userId)) return true;
  const rows = await query<{ plan: string }>(
    "SELECT plan FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.plan === "admin";
}
