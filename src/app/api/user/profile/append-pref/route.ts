import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

const MAX_PREF_LEN = 200;
const MAX_EXTRA_CONTEXT_LEN = 4000;

// 结构化 PG 错误描述：把 SQLSTATE / table / detail 等带出去，便于排查
function describeError(e: unknown) {
  const err = e as {
    code?: string;
    message?: string;
    detail?: string;
    hint?: string;
    table?: string;
    routine?: string;
    name?: string;
  };
  return {
    name: err?.name,
    code: err?.code,
    message: err?.message,
    detail: err?.detail,
    hint: err?.hint,
    table: err?.table,
    routine: err?.routine,
  };
}

// POST /api/user/profile/append-pref
// body: { pref: string }
// 把新捕获的偏好以「- {pref}」追加到 user_profiles.extra_context。
// 用 UPSERT 一次性处理「行不存在」场景，避免读-写竞态。
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: { pref?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const pref = body.pref?.trim();
    if (!pref) {
      return NextResponse.json({ error: "偏好不能为空" }, { status: 422 });
    }
    const safe = pref.slice(0, MAX_PREF_LEN);

    // 读现有 extra_context（行可能不存在）
    let existing = "";
    try {
      const rows = await query<{ extra_context: string | null }>(
        "SELECT extra_context FROM user_profiles WHERE user_id = $1",
        [session.user.id]
      );
      existing = rows[0]?.extra_context ?? "";
    } catch (e) {
      const info = describeError(e);
      console.error("[append-pref] SELECT 失败:", info, e);
      // 表不存在（SQLSTATE 42P01）：精准提示
      if (info.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "投资人画像表不存在 —— 请执行数据库迁移 db/migrations/011_user_profile.sql",
            code: info.code,
            detail: info.detail,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        {
          error: info.message || "读取画像失败",
          code: info.code,
          detail: info.detail,
        },
        { status: 500 }
      );
    }

    const merged = (existing ? `${existing}\n` : "") + `- ${safe}`;
    const trimmed = merged.slice(-MAX_EXTRA_CONTEXT_LEN);

    // UPSERT：行不存在则 INSERT；存在则更新
    try {
      await query(
        `INSERT INTO user_profiles (user_id, extra_context)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           extra_context = EXCLUDED.extra_context,
           updated_at = NOW()`,
        [session.user.id, trimmed]
      );
    } catch (e) {
      const info = describeError(e);
      console.error("[append-pref] UPSERT 失败:", info, e);
      if (info.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "投资人画像表不存在 —— 请执行数据库迁移 db/migrations/011_user_profile.sql",
            code: info.code,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        {
          error: info.message || "保存失败",
          code: info.code,
          detail: info.detail,
          hint: info.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const info = describeError(e);
    console.error("[append-pref] 未捕获:", info, e);
    return NextResponse.json(
      { error: info.message || "服务器错误", code: info.code },
      { status: 500 }
    );
  }
}
