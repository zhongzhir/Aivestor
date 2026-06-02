// 服务端 admin 权限校验工具
//
// 双重防护策略：
//   1) middleware (Edge) 用 JWT token.plan 做快路径拦截
//   2) 本文件函数在 Node 运行时直接查 DB，避免 token 缓存假阳性
//      （例如：管理员被降级后 token 还没刷新）
//
// 所有 (admin) 页面与 /api/admin/* 路由必须调用本文件。

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

interface AdminCheckResult {
  ok: boolean;
  userId?: string;
  email?: string | null;
}

// 从 DB 现取 plan，确认是否为 admin。
async function checkAdmin(): Promise<AdminCheckResult> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };

  const rows = await query<{ plan: string; email: string | null }>(
    "SELECT plan, email FROM users WHERE id = $1",
    [userId]
  );
  const user = rows[0];
  if (!user || user.plan !== "admin") return { ok: false };
  return { ok: true, userId, email: user.email };
}

// 用于 (admin) 下的 Server Component / layout / page：
// 非 admin 直接 redirect 到 /dashboard。
export async function requireAdmin(): Promise<{
  userId: string;
  email: string | null;
}> {
  const r = await checkAdmin();
  if (!r.ok) redirect("/dashboard");
  return { userId: r.userId!, email: r.email ?? null };
}

// 用于 /api/admin/* 路由：非 admin 返回 403 NextResponse。
export async function requireAdminAPI(): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: NextResponse }
> {
  const r = await checkAdmin();
  if (!r.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: r.userId!, email: r.email ?? null };
}
