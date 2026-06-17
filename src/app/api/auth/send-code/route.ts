import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";
import { sendSms } from "@/lib/aliyun";
import { isValidPhone } from "@/lib/authUtils";

// POST /api/auth/send-code — 发送手机验证码
export async function POST(req: Request) {
  try {
    let body: { phone?: string; purpose?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const phone = body.phone?.trim();
    // login / register / bind（bind = 已登录邮箱账号补绑手机号，F-15 方向A）
    const purpose =
      body.purpose === "register"
        ? "register"
        : body.purpose === "bind"
          ? "bind"
          : "login";
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json({ error: "手机号格式不正确" }, { status: 400 });
    }

    // 限流：1 分钟内最多 1 次
    const lastMinute = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM phone_verify_codes
        WHERE phone = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
      [phone]
    );
    if (Number(lastMinute[0]?.count ?? 0) >= 1) {
      return NextResponse.json(
        { error: "验证码发送过于频繁，请稍后再试" },
        { status: 429 }
      );
    }
    // 限流：1 小时内最多 5 次
    const lastHour = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM phone_verify_codes
        WHERE phone = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [phone]
    );
    if (Number(lastHour[0]?.count ?? 0) >= 5) {
      return NextResponse.json(
        { error: "今日验证码发送次数过多，请稍后再试" },
        { status: 429 }
      );
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await query(
      `INSERT INTO phone_verify_codes (phone, code, purpose, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
      [phone, code, purpose]
    );
    await sendSms(phone, code);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[send-code] 失败:", err);
    return NextResponse.json(
      { error: "验证码发送失败，请稍后重试" },
      { status: 500 }
    );
  }
}
