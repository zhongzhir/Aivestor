import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

const TYPES = new Set(["founder", "co_investor", "expert", "referrer", "customer", "other"]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const scope = await buildAccessScope(session.user.id);
    await assertProjectAccess(scope, params.id, "read");
    const child = scopedProjectChildWhere(scope, 2, { alias: "r" });
    const relationships = await query(
      `SELECT r.id, r.person_name, r.role_title, r.organization_name,
              r.relationship_type, r.relationship_strength, r.source_note,
              r.note, r.created_at, r.updated_at
         FROM project_relationships r
        WHERE r.project_id = $1 AND ${child.sql}
        ORDER BY r.created_at DESC`,
      [params.id, ...child.params]
    );
    return NextResponse.json({ relationships });
  } catch (e) {
    try { return accessErrorResponse(e); } catch { return NextResponse.json({ error: "读取关系记录失败" }, { status: 500 }); }
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const scope = await buildAccessScope(session.user.id);
    const access = await assertProjectAccess(scope, params.id, "write");
    const body = await req.json();
    const personName = typeof body.person_name === "string" ? body.person_name.trim() : "";
    if (!personName) return NextResponse.json({ error: "请填写姓名或机构名称" }, { status: 422 });
    const type = TYPES.has(body.relationship_type) ? body.relationship_type : "other";
    const strength = Math.min(5, Math.max(1, Number(body.relationship_strength) || 3));
    const rows = await query(
      `INSERT INTO project_relationships
       (project_id, user_id, org_id, person_name, role_title, organization_name,
        relationship_type, relationship_strength, source_note, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, person_name, role_title, organization_name, relationship_type,
                 relationship_strength, source_note, note, created_at, updated_at`,
      [params.id, session.user.id, access.orgId, personName,
       body.role_title?.trim() || null, body.organization_name?.trim() || null,
       type, strength, body.source_note?.trim() || null, body.note?.trim() || null]
    );
    return NextResponse.json({ relationship: rows[0] }, { status: 201 });
  } catch (e) {
    try { return accessErrorResponse(e); } catch { return NextResponse.json({ error: "保存关系记录失败" }, { status: 500 }); }
  }
}
