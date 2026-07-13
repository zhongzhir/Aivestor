import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

interface MetricRow {
  id: string;
  metric_name: string;
  value_numeric: string;
  unit: string | null;
  period: string;
  source_type: string;
  source_id: string | null;
  note: string | null;
  created_at: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "read");
    } catch (e) {
      return accessErrorResponse(e);
    }
    const child = scopedProjectChildWhere(scope, 2);
    const rows = await query<MetricRow>(
      `SELECT id, metric_name, value_numeric, unit, period, source_type,
              source_id, note, created_at
         FROM post_investment_metrics
        WHERE project_id = $1 AND ${child.sql}
        ORDER BY metric_name ASC, period DESC, created_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ metrics: rows });
  } catch (e) {
    console.error("[post-metrics] GET 失败:", e);
    return NextResponse.json({ error: "读取指标失败" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const scope = await buildAccessScope(session.user.id);
    let orgId: string | null = null;
    try {
      orgId = (await assertProjectAccess(scope, params.id, "write")).orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }
    const body = (await req.json()) as {
      metric_name?: string;
      value_numeric?: number | string;
      unit?: string;
      period?: string;
      note?: string;
    };
    const metricName = body.metric_name?.trim();
    const period = body.period?.trim();
    const value = Number(body.value_numeric);
    if (!metricName || !period || !Number.isFinite(value)) {
      return NextResponse.json({ error: "请填写指标名称、数值和周期" }, { status: 422 });
    }
    const rows = await query<MetricRow>(
      `INSERT INTO post_investment_metrics
         (project_id, user_id, org_id, metric_name, value_numeric, unit, period, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, metric_name, value_numeric, unit, period, source_type,
                 source_id, note, created_at`,
      [
        params.id,
        session.user.id,
        orgId,
        metricName,
        value,
        body.unit?.trim() || null,
        period,
        body.note?.trim() || null,
      ]
    );
    return NextResponse.json({ metric: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[post-metrics] POST 失败:", e);
    return NextResponse.json({ error: "保存指标失败" }, { status: 500 });
  }
}
