import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidPhone, verifyPhoneCode } from "@/lib/authUtils";
import {
  TRIAL_QUOTA_LIMIT,
  LEGACY_BIND_BONUS,
  getFullQuotaLimit,
} from "@/lib/freeQuota";

// 已登录邮箱账号补绑手机号（F-15 方向A）。
// 现有手机验证基础设施（phone_verify_codes / send-code / verifyPhoneCode）原本
// 只服务登录/注册场景，无"为已存在账号绑定手机号"的入口，故新增本路由：
//   - 验证码用途为 'bind'（send-code 已放开该 purpose）
//   - 绑定成功后按改动2的 CASE 逻辑提升免费额度上限

function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

// GET /api/user/bind-phone — 当前账号的手机绑定状态（供设置页/提示判断）
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const rows = await query<{ phone: string | null }>(
    "SELECT phone FROM users WHERE id = $1",
    [session.user.id]
  );
  const phone = rows[0]?.phone ?? null;
  return NextResponse.json({
    bound: !!phone,
    phoneMasked: phone ? maskPhone(phone) : null,
  });
}

// POST /api/user/bind-phone — 校验验证码并绑定手机号 + 提升免费额度
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const phone = body.phone?.trim();
  const code = body.code?.trim();
  if (!phone || !isValidPhone(phone) || !code) {
    return NextResponse.json({ error: "手机号或验证码不正确" }, { status: 400 });
  }

  // 当前账号必须尚未绑定手机号（NULL→设置 这一次转移才触发额度提升）。
  const current = await query<{ phone: string | null }>(
    "SELECT phone FROM users WHERE id = $1",
    [userId]
  );
  if (current[0]?.phone) {
    return NextResponse.json({ error: "当前账号已绑定手机号" }, { status: 409 });
  }

  // 校验并消费验证码（用途 bind）。
  const ok = await verifyPhoneCode(phone, code, "bind", true);
  if (!ok) {
    return NextResponse.json({ error: "验证码无效或已过期" }, { status: 400 });
  }

  // 写入手机号。users.phone 唯一，已被他号占用则报 23505。
  try {
    await query("UPDATE users SET phone = $1 WHERE id = $2", [phone, userId]);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      return NextResponse.json(
        { error: "该手机号已被其他账号绑定" },
        { status: 409 }
      );
    }
    throw e;
  }

  // 改动2：绑定成功后按当前额度上限分支提升（单条 CASE，避免竞态）。
  //   - <= 试用额度（从未拿过完整额度的新用户）→ 直接升到完整额度
  //   - >  试用额度（存量用户，已在用更高上限）→ 在当前值基础上追加 bonus
  // 行不存在（从未触发过额度消耗）则 UPDATE 影响 0 行：后续首次用 AI 时
  // getFreeQuotaStatus 会以"已绑定"身份按完整额度创建，结果一致。
  const fullLimit = getFullQuotaLimit();
  await query(
    `UPDATE free_quota_usage
        SET tokens_limit = CASE
              WHEN tokens_limit <= $2 THEN $3
              ELSE tokens_limit + $4
            END,
            updated_at = NOW()
      WHERE user_id = $1`,
    [userId, TRIAL_QUOTA_LIMIT, fullLimit, LEGACY_BIND_BONUS]
  );

  return NextResponse.json({ ok: true, phoneMasked: maskPhone(phone) });
}
