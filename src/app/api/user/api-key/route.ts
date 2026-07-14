import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decrypt, encrypt, maskKey } from "@/lib/crypto";
import { isValidProvider } from "@/lib/ai";

interface UserKeyRow {
  api_key_encrypted: string | null;
  ai_provider: string | null;
  ai_base_url: string | null;
}

// GET /api/user/api-key — 返回当前用户的 API Key（脱敏）与服务商
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // ai_base_url 由迁移 016 引入；未应用时兼容回退
  let row: UserKeyRow | undefined;
  try {
    const rows = await query<UserKeyRow>(
      "SELECT api_key_encrypted, ai_provider, ai_base_url FROM users WHERE id = $1",
      [session.user.id]
    );
    row = rows[0];
  } catch {
    const fallback = await query<{
      api_key_encrypted: string | null;
      ai_provider: string | null;
    }>("SELECT api_key_encrypted, ai_provider FROM users WHERE id = $1", [
      session.user.id,
    ]);
    row = fallback[0]
      ? { ...fallback[0], ai_base_url: null }
      : undefined;
  }
  const provider = row?.ai_provider || "deepseek";

  let maskedKey: string | null = null;
  if (row?.api_key_encrypted) {
    try {
      maskedKey = maskKey(decrypt(row.api_key_encrypted));
    } catch {
      maskedKey = null;
    }
  }

  return NextResponse.json({
    configured: maskedKey !== null,
    maskedKey,
    provider,
    baseUrl: row?.ai_base_url ?? null,
  });
}

// POST /api/user/api-key — 加密保存 API Key 与服务商
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { apiKey?: string; provider?: string; baseUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const provider = body.provider?.trim() || "";
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "不支持的服务商" }, { status: 400 });
  }

  // baseUrl：空字符串或缺失视为 null（清空，回到默认 endpoint）
  const baseUrl =
    typeof body.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : null;

  const apiKey = body.apiKey?.trim();
  try {
    if (apiKey) {
      // 同时更新 Key / 服务商 / baseUrl
      await query(
        `UPDATE users
            SET api_key_encrypted = $1, ai_provider = $2, ai_base_url = $3
          WHERE id = $4`,
        [encrypt(apiKey), provider, baseUrl, session.user.id]
      );
    } else {
      // 仅更新服务商 / baseUrl，保留原有 Key
      await query(
        "UPDATE users SET ai_provider = $1, ai_base_url = $2 WHERE id = $3",
        [provider, baseUrl, session.user.id]
      );
    }
  } catch (e) {
    // ai_base_url 列不存在时（迁移未跑）回退到旧字段集
    console.warn("[api-key] 写入失败，回退到旧字段集:", e);
    if (apiKey) {
      await query(
        "UPDATE users SET api_key_encrypted = $1, ai_provider = $2 WHERE id = $3",
        [encrypt(apiKey), provider, session.user.id]
      );
    } else {
      await query("UPDATE users SET ai_provider = $1 WHERE id = $2", [
        provider,
        session.user.id,
      ]);
    }
  }

  return NextResponse.json({ ok: true, provider, baseUrl });
}

// DELETE /api/user/api-key — 移除自有 Key，恢复平台免费额度路径
export async function DELETE() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    await query(
      `UPDATE users
          SET api_key_encrypted = NULL,
              ai_provider = 'deepseek',
              ai_base_url = NULL
        WHERE id = $1`,
      [session.user.id]
    );
  } catch (e) {
    // 兼容尚未应用 ai_base_url 迁移的旧数据库。
    console.warn("[api-key] 移除 Key 时回退到旧字段集:", e);
    await query(
      `UPDATE users
          SET api_key_encrypted = NULL,
              ai_provider = 'deepseek'
        WHERE id = $1`,
      [session.user.id]
    );
  }

  return NextResponse.json({
    ok: true,
    configured: false,
    provider: "deepseek",
    baseUrl: null,
  });
}
