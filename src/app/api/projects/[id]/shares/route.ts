import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope, type AccessScope } from "@/lib/resourceAccess";

// 共享操作授权：项目 owner 本人，或 partner/admin。
async function loadOrgProject(
  scope: AccessScope,
  projectId: string
): Promise<{ orgId: string; ownerId: string | null } | null> {
  const rows = await query<{ org_id: string | null; owner_id: string | null }>(
    "SELECT org_id, owner_id FROM projects WHERE id = $1 AND deleted_at IS NULL",
    [projectId]
  );
  const proj = rows[0];
  if (!proj || !proj.org_id) return null; // 仅组织项目可共享
  if (!scope.org || scope.org.orgId !== proj.org_id) return null;
  return { orgId: proj.org_id, ownerId: proj.owner_id };
}

function canManageShares(
  scope: AccessScope,
  ownerId: string | null
): boolean {
  if (!scope.org) return false;
  if (scope.org.role === "admin" || scope.org.role === "partner") return true;
  return ownerId === scope.userId; // owner 本人
}

// GET /api/projects/[id]/shares — 当前共享成员列表
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  const proj = await loadOrgProject(scope, params.id);
  if (!proj) return NextResponse.json({ shares: [] });

  const shares = await query<{ shared_with: string; user_name: string | null }>(
    `SELECT s.shared_with, u.name AS user_name
       FROM project_shares s
       LEFT JOIN users u ON u.id = s.shared_with
      WHERE s.project_id = $1`,
    [params.id]
  );
  return NextResponse.json({ shares });
}

// POST /api/projects/[id]/shares — 共享给组织成员（owner 或 partner+）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  const proj = await loadOrgProject(scope, params.id);
  if (!proj) {
    return NextResponse.json({ error: "项目不存在或非组织项目" }, { status: 404 });
  }
  if (!canManageShares(scope, proj.ownerId)) {
    return NextResponse.json({ error: "无权共享该项目" }, { status: 403 });
  }

  let body: { sharedWith?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const ids = Array.isArray(body.sharedWith)
    ? body.sharedWith.filter((x): x is string => typeof x === "string" && !!x)
    : typeof body.sharedWith === "string" && body.sharedWith
      ? [body.sharedWith]
      : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "请选择共享对象" }, { status: 422 });
  }

  // 仅允许共享给同组织成员
  const members = await query<{ user_id: string }>(
    "SELECT user_id FROM org_members WHERE org_id = $1 AND user_id = ANY($2::uuid[])",
    [proj.orgId, ids]
  );
  const validIds = members.map((m) => m.user_id);
  for (const target of validIds) {
    await query(
      `INSERT INTO project_shares (project_id, org_id, shared_with, shared_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, shared_with) DO NOTHING`,
      [params.id, proj.orgId, target, session.user.id]
    );
  }
  return NextResponse.json({ success: true, shared: validIds });
}

// DELETE /api/projects/[id]/shares — 取消共享（owner 或 partner+）
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const scope = await buildAccessScope(session.user.id);
  const proj = await loadOrgProject(scope, params.id);
  if (!proj) {
    return NextResponse.json({ error: "项目不存在或非组织项目" }, { status: 404 });
  }
  if (!canManageShares(scope, proj.ownerId)) {
    return NextResponse.json({ error: "无权操作该项目共享" }, { status: 403 });
  }

  let body: { sharedWith?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!body.sharedWith) {
    return NextResponse.json({ error: "缺少取消对象" }, { status: 422 });
  }
  await query(
    "DELETE FROM project_shares WHERE project_id = $1 AND shared_with = $2",
    [params.id, body.sharedWith]
  );
  return NextResponse.json({ success: true });
}
