// POST /api/admin/quota
// body: { userIds: string[]; tokensLimit: number }
// 批量把指定用户的 free_quota_usage.tokens_limit 调整为新值；
// 若 free_quota_usage 中尚无该 user 行（首次使用 AI 时才会插入），INSERT 一条。
//
// 双重权限：middleware 已挡，本路由还要 requireAdminAPI 现取 DB 再校验。

import { NextResponse } from "next/server";
import { requireAdminAPI } from "@/lib/adminAuth";
import { query } from "@/lib/db";

const DEFAULT_USED = 0;
const MAX_LIMIT = 1_000_000_000; // 10 亿 tokens 上限，防误填爆数字

export async function POST(req: Request) {
  const guard = await requireAdminAPI();
  if (!guard.ok) return guard.response;

  let body: { userIds?: unknown; tokensLimit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((x): x is string => typeof x === "string")
    : [];
  const tokensLimit = Number(body.tokensLimit);

  if (userIds.length === 0) {
    return NextResponse.json({ error: "userIds 不能为空" }, { status: 400 });
  }
  if (!Number.isFinite(tokensLimit) || tokensLimit < 0 || tokensLimit > MAX_LIMIT) {
    return NextResponse.json(
      { error: `tokensLimit 必须为 0 ~ ${MAX_LIMIT} 之间的整数` },
      { status: 400 }
    );
  }

  // UPSERT：若 user 已有 free_quota_usage 行则 UPDATE，否则 INSERT
  // free_quota_usage 在 018 起以 user_id 为唯一键
  const result = await query<{ user_id: string }>(
    `INSERT INTO free_quota_usage (user_id, tokens_used, tokens_limit)
       SELECT id, $1, $2 FROM users WHERE id = ANY($3::uuid[])
    ON CONFLICT (user_id) DO UPDATE
       SET tokens_limit = EXCLUDED.tokens_limit,
           updated_at   = now()
     RETURNING user_id`,
    [DEFAULT_USED, Math.floor(tokensLimit), userIds]
  );

  return NextResponse.json({
    ok: true,
    updated: result.length,
    tokensLimit: Math.floor(tokensLimit),
  });
}
