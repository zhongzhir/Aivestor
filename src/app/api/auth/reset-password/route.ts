import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { validatePassword } from "@/lib/authUtils";

// POST /api/auth/reset-password — 用重置令牌设置新密码
export async function POST(req: Request) {
  try {
    let body: { token?: string; newPassword?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const token = body.token?.trim();
    const newPassword = body.newPassword ?? "";
    if (!token) {
      return NextResponse.json({ error: "重置链接无效" }, { status: 400 });
    }
    const pwError = validatePassword(newPassword);
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    const rows = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );
    const record = rows[0];
    if (!record) {
      return NextResponse.json(
        { error: "重置链接无效或已过期，请重新发起" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // password_changed_at 置为 now()：使改密前签发的 JWT 会话失效（审计 F-06）。
    await query(
      "UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2",
      [passwordHash, record.user_id]
    );
    await query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
      [record.id]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] 失败:", err);
    return NextResponse.json(
      { error: "重置失败，请稍后重试" },
      { status: 500 }
    );
  }
}
