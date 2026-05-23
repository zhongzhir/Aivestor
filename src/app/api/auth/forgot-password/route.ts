import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";
import { sendEmail } from "@/lib/aliyun";
import { isValidEmail } from "@/lib/authUtils";

const APP_URL = "https://vestia-two.vercel.app";

// 无论邮箱是否存在都返回此提示，防止邮箱枚举。
const GENERIC = {
  ok: true,
  message: "如果该邮箱已注册，你将收到一封密码重置邮件。",
};

// POST /api/auth/forgot-password — 发起密码重置
export async function POST(req: Request) {
  let email: string | undefined;
  try {
    let body: { email?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }
    email = body.email?.toLowerCase().trim();
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }

    const users = await query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    const user = users[0];

    if (user) {
      // 限流：同一邮箱 1 小时内最多 3 次
      const recent = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM password_reset_tokens
          WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [user.id]
      );
      if (Number(recent[0]?.count ?? 0) < 3) {
        // 作废该账号此前未使用的重置令牌，确保仅最新链接有效。
        await query(
          `UPDATE password_reset_tokens SET used_at = NOW()
            WHERE user_id = $1 AND used_at IS NULL`,
          [user.id]
        );
        const token = crypto.randomBytes(32).toString("hex");
        await query(
          `INSERT INTO password_reset_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
          [user.id, token]
        );
        const link = `${APP_URL}/reset-password?token=${token}`;
        await sendEmail(
          email,
          "重置你的 Aivestor 账号密码",
          `<div style="font-family:-apple-system,sans-serif;line-height:1.7;color:#37352f">
             <p>你好，</p>
             <p>我们收到了重置你 Aivestor 投资工作台账号密码的请求。请点击下方链接设置新密码，链接 15 分钟内有效：</p>
             <p><a href="${link}" style="color:#1B6FE8">${link}</a></p>
             <p style="color:#787774;font-size:13px">如果你没有发起此请求，请忽略本邮件，你的密码不会被更改。</p>
           </div>`
        );
      }
    }

    return NextResponse.json(GENERIC);
  } catch (err) {
    // 发信/数据库失败也返回通用提示，避免泄露邮箱存在性
    console.error("[forgot-password] 失败:", err);
    return NextResponse.json(GENERIC);
  }
}
