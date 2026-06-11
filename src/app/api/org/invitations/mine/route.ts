// GET /api/org/invitations/mine — 我收到的待处理邀请（登录用户）
//
// 注意：本路由不要求用户已有组织（与 /api/org/* 其余路由不同），
// 因为被邀请人通常是无组织用户。

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const rows = await query<{
      id: string;
      role: string;
      expires_at: string;
      created_at: string;
      org_name: string;
      invited_by_name: string | null;
    }>(
      `SELECT i.id, i.role, i.expires_at, i.created_at,
              o.name AS org_name,
              iu.name AS invited_by_name
         FROM org_invitations i
         JOIN orgs o ON o.id = i.org_id AND o.is_active = true
         JOIN users u ON (u.email = i.identifier OR u.phone = i.identifier)
         LEFT JOIN users iu ON iu.id = i.invited_by
        WHERE u.id = $1
          AND i.status = 'pending'
          AND i.expires_at > now()
        ORDER BY i.created_at DESC`,
      [session.user.id]
    );
    return NextResponse.json({ invitations: rows });
  } catch {
    // 迁移 020 未执行时表不存在：返回空列表，前端卡片自动隐藏
    return NextResponse.json({ invitations: [] });
  }
}
