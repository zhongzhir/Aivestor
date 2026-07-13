import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

interface ExitStrategyRow {
  id: string;
  primary_path: string;
  alternative_paths: string[];
  target_window: string | null;
  valuation_note: string | null;
  return_note: string | null;
  status: string;
  updated_at: string;
}

async function getAccess(req: Request, projectId: string, mode: "read" | "write") {
  const session = await getSession();
  if (!session?.user) return { response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, projectId, mode);
  } catch (e) {
    return { response: accessErrorResponse(e) };
  }
  return { session, scope };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const access = await getAccess(_req, params.id, "read");
    if (access.response) return access.response;
    const child = scopedProjectChildWhere(access.scope, 2);
    const rows = await query<ExitStrategyRow>(
      `SELECT id, primary_path, alternative_paths, target_window,
              valuation_note, return_note, status, updated_at
         FROM post_investment_exit_strategies
        WHERE project_id = $1 AND ${child.sql}
        LIMIT 1`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ strategy: rows[0] ?? null });
  } catch (e) {
    console.error("[exit-strategy] GET 失败:", e);
    return NextResponse.json({ error: "读取退出策略失败" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const access = await getAccess(req, params.id, "write");
    if (access.response) return access.response;
    const body = (await req.json()) as {
      primary_path?: string;
      alternative_paths?: string[];
      target_window?: string;
      valuation_note?: string;
      return_note?: string;
      status?: string;
    };
    const primaryPath = body.primary_path?.trim();
    if (!primaryPath) return NextResponse.json({ error: "请填写主要退出路径" }, { status: 422 });
    const status = ["monitoring", "preparing", "executing", "completed", "paused"].includes(body.status ?? "")
      ? body.status
      : "monitoring";
    const paths = Array.isArray(body.alternative_paths)
      ? body.alternative_paths.map((item) => item.trim()).filter(Boolean).slice(0, 5)
      : [];
    const rows = await query<ExitStrategyRow>(
      `INSERT INTO post_investment_exit_strategies
         (project_id, user_id, org_id, primary_path, alternative_paths,
          target_window, valuation_note, return_note, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (project_id) DO UPDATE SET
         primary_path = EXCLUDED.primary_path,
         alternative_paths = EXCLUDED.alternative_paths,
         target_window = EXCLUDED.target_window,
         valuation_note = EXCLUDED.valuation_note,
         return_note = EXCLUDED.return_note,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id, primary_path, alternative_paths, target_window,
                 valuation_note, return_note, status, updated_at`,
      [
        params.id,
        access.session.user.id,
        access.scope.org?.orgId ?? null,
        primaryPath,
        JSON.stringify(paths),
        body.target_window?.trim() || null,
        body.valuation_note?.trim() || null,
        body.return_note?.trim() || null,
        status,
      ]
    );
    return NextResponse.json({ strategy: rows[0] });
  } catch (e) {
    console.error("[exit-strategy] PUT 失败:", e);
    return NextResponse.json({ error: "保存退出策略失败" }, { status: 500 });
  }
}
