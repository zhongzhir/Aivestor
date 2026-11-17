import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { accessErrorResponse, assertProjectAccess, buildAccessScope, scopedProjectWhere } from "@/lib/resourceAccess";

interface ListRow {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  updated_at: string;
}

// 把 pg 错误结构化输出到日志 + 返回给前端，便于排查迁移未跑等场景。
// 注意：仅返回错误码/消息文本，不回传 stack。
function describeError(e: unknown) {
  // node-postgres 错误对象常见字段：code（SQLSTATE）、message、detail、hint、table
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

// GET /api/conversations — 当前用户的对话列表（不含 messages）
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const projectId = new URL(req.url).searchParams.get("project_id");
    const scope = await buildAccessScope(session.user.id);
    if (projectId) {
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: "项目无效" }, { status: 400 });
      try { await assertProjectAccess(scope, projectId, "read"); }
      catch (error) { return accessErrorResponse(error); }
    }
    const visible = scopedProjectWhere(scope, 3, { alias: "p" });
    const rows = await query<ListRow>(
      `SELECT c.id, c.title, c.project_id, p.name AS project_name, c.updated_at
         FROM conversations c
         LEFT JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
        WHERE c.user_id = $1
          AND ($2::uuid IS NULL OR c.project_id = $2)
          AND (c.project_id IS NULL OR (p.id IS NOT NULL AND ${visible.sql}))
        ORDER BY c.updated_at DESC
        LIMIT 50`,
      [session.user.id, projectId, ...visible.params]
    );

    return NextResponse.json({ conversations: rows });
  } catch (e) {
    const info = describeError(e);
    console.error("[conversations][GET] 失败:", info, e);
    const hint =
      info.code === "42P01"
        ? "对话表不存在 —— 请执行数据库迁移 db/migrations/013_conversations.sql"
        : undefined;
    return NextResponse.json(
      {
        error: info.message || "服务器错误",
        code: info.code,
        hint,
        detail: info.detail,
      },
      { status: 500 }
    );
  }
}

// POST /api/conversations — 新建对话
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: { project_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      // 允许空 body
    }

    // 校验项目归属，避免越权关联
    let projectId: string | null = null;
    if (body.project_id) {
      if (typeof body.project_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.project_id)) {
        return NextResponse.json({ error: "项目无效" }, { status: 400 });
      }
      try { await assertProjectAccess(await buildAccessScope(session.user.id), body.project_id, "read"); }
      catch (error) { return accessErrorResponse(error); }
      projectId = body.project_id;
    }

    const inserted = await query<{
      id: string;
      title: string | null;
      project_id: string | null;
      updated_at: string;
    }>(
      `INSERT INTO conversations (user_id, project_id)
       VALUES ($1, $2)
       RETURNING id, title, project_id, updated_at`,
      [session.user.id, projectId]
    );

    return NextResponse.json(
      { conversation: inserted[0] },
      { status: 201 }
    );
  } catch (e) {
    const info = describeError(e);
    // 完整结构化打印 —— 服务端日志可看
    console.error("[conversations][POST] 失败:", info, e);

    // 表不存在（SQLSTATE 42P01）：精准提示用户跑迁移
    if (info.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "对话表不存在 —— 请执行数据库迁移 db/migrations/013_conversations.sql",
          code: info.code,
          detail: info.detail,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: info.message || "服务器错误",
        code: info.code,
        detail: info.detail,
        hint: info.hint,
      },
      { status: 500 }
    );
  }
}
