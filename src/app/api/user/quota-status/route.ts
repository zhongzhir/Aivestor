import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFreeQuotaStatus, isSystemKeyAvailable } from "@/lib/freeQuota";

// GET /api/user/quota-status — 当前用户的免费额度状态（以 user_id 为键）
//
// 返回形状：
//   { enabled: false, reason: 'system_key_not_configured' } 系统未配置代付 Key
//   { enabled: false, reason: 'unavailable' } 表缺失等无法启用的场景
//   { enabled: true, available: bool, tokensUsed, tokensLimit, tokensRemaining }
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!isSystemKeyAvailable()) {
    return NextResponse.json({
      enabled: false,
      reason: "system_key_not_configured",
    });
  }

  const status = await getFreeQuotaStatus(session.user.id);
  if (!status) {
    return NextResponse.json({ enabled: false, reason: "unavailable" });
  }

  return NextResponse.json({
    enabled: true,
    available: status.available,
    tokensUsed: status.tokensUsed,
    tokensLimit: status.tokensLimit,
    tokensRemaining: status.tokensRemaining,
  });
}
