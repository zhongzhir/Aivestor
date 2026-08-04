import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOrgContext } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { INTELLIGENCE_PLAN_LIMITS } from "@/lib/intelligenceConfig";
export { INTELLIGENCE_GENERATION_ESTIMATED_TOKENS, INTELLIGENCE_PLAN_LIMITS } from "@/lib/intelligenceConfig";

export type IntelligenceTier = "personal" | "organization";

export interface IntelligenceAccess {
  userId: string;
  tier: IntelligenceTier;
  hasEnhancedData: boolean;
  limits: (typeof INTELLIGENCE_PLAN_LIMITS)[IntelligenceTier];
}

export async function getIntelligenceAccess(userId: string): Promise<IntelligenceAccess> {
  const org = await getOrgContext(userId);
  const hasEnhancedData = org?.capabilities.zjjr_data === true;
  const tier: IntelligenceTier = hasEnhancedData ? "organization" : "personal";
  return { userId, tier, hasEnhancedData, limits: INTELLIGENCE_PLAN_LIMITS[tier] };
}

export async function requireIntelligenceAPI(): Promise<
  | { ok: true; access: IntelligenceAccess }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  return { ok: true, access: await getIntelligenceAccess(userId) };
}

export function intelligenceLimitError(
  access: IntelligenceAccess,
  input: { maxItems: number; executionMode: "manual" | "scheduled" }
): string | null {
  if (input.maxItems > access.limits.maxItems) {
    return `当前版本单次最多整理 ${access.limits.maxItems} 条信息`;
  }
  if (input.executionMode === "scheduled" && access.limits.maxScheduleFrequency !== "daily") {
    return "当前版本暂不支持更高频率的定时生成";
  }
  return null;
}

export async function activeTaskLimitError(
  access: IntelligenceAccess,
  excludeTaskId?: string
): Promise<string | null> {
  if (access.tier !== "personal") return null;
  const params: string[] = [access.userId];
  const exclude = excludeTaskId ? " AND id <> $2" : "";
  if (excludeTaskId) params.push(excludeTaskId);
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM intelligence_tasks WHERE user_id = $1 AND is_active = true${exclude}`,
    params
  );
  if (Number(rows[0]?.count ?? 0) >= access.limits.maxActiveTasks) {
    return `当前版本最多启用 ${access.limits.maxActiveTasks} 个情报任务`;
  }
  return null;
}
