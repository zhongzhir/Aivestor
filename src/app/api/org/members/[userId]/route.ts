// PATCH  /api/org/members/[userId] — 改角色（org admin）
// DELETE /api/org/members/[userId] — 移除成员（org admin），
//         含架构文档 v1.1 第 1.5 节资产交接逻辑。

import { NextResponse } from "next/server";
import { requireOrgAPI } from "@/lib/orgAuth";
import { query, pool } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROLES = ["admin", "partner", "analyst"] as const;

// 组织内必须始终保留至少一名 admin
async function isLastAdmin(orgId: string, userId: string): Promise<boolean> {
  const rows = await query<{ role: string }>(
    "SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2",
    [orgId, userId]
  );
  if (rows[0]?.role !== "admin") return false;
  const admins = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM org_members
      WHERE org_id = $1 AND role = 'admin'`,
    [orgId]
  );
  return Number(admins[0]?.c ?? 0) <= 1;
}

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  if (!UUID_RE.test(params.userId)) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  let body: { role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const role = body.role;
  if (typeof role !== "string" || !VALID_ROLES.includes(role as never)) {
    return NextResponse.json({ error: "角色不合法" }, { status: 400 });
  }

  if (role !== "admin" && (await isLastAdmin(ctx.orgId, params.userId))) {
    return NextResponse.json(
      { error: "组织至少需保留一名管理员，请先指定其他管理员" },
      { status: 400 }
    );
  }

  const updated = await query<{ id: string }>(
    `UPDATE org_members SET role = $1
      WHERE org_id = $2 AND user_id = $3
      RETURNING id`,
    [role, ctx.orgId, params.userId]
  );
  if (updated.length === 0) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// 迁移 021（P2）执行前 projects 还没有 org_id / owner_id 列。
// 用 information_schema 探测列是否存在：不存在则跳过项目交接检查，
// P2 迁移 021 执行后此分支自动生效，接口签名无需二次变更。
async function projectsHaveOrgColumns(): Promise<boolean> {
  try {
    const rows = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects'
          AND column_name IN ('org_id', 'owner_id')`
    );
    return Number(rows[0]?.c ?? 0) >= 2;
  } catch {
    return false;
  }
}

// project_shares 由迁移 023（P2）创建，同样探测容错
async function projectSharesExists(): Promise<boolean> {
  try {
    const rows = await query<{ ok: string | null }>(
      "SELECT to_regclass('public.project_shares')::text AS ok"
    );
    return !!rows[0]?.ok;
  } catch {
    return false;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const guard = await requireOrgAPI("admin");
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  if (!UUID_RE.test(params.userId)) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  const target = await query<{ id: string }>(
    "SELECT id FROM org_members WHERE org_id = $1 AND user_id = $2",
    [ctx.orgId, params.userId]
  );
  if (target.length === 0) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }

  if (await isLastAdmin(ctx.orgId, params.userId)) {
    return NextResponse.json(
      { error: "组织至少需保留一名管理员，无法移除" },
      { status: 400 }
    );
  }

  // transferOwnerTo 可选：有待交接项目时必填（1.5）
  let transferOwnerTo: string | undefined;
  try {
    const body = (await req.json()) as { transferOwnerTo?: unknown };
    if (typeof body.transferOwnerTo === "string") {
      transferOwnerTo = body.transferOwnerTo;
    }
  } catch {
    // 无 body 是合法的（无待交接项目时不需要）
  }

  const hasOrgColumns = await projectsHaveOrgColumns();

  // 1.5 前置校验：该成员名下存在组织项目时，必须指定接收人
  if (hasOrgColumns) {
    const owned = await query<{ id: string; name: string }>(
      "SELECT id, name FROM projects WHERE org_id = $1 AND owner_id = $2",
      [ctx.orgId, params.userId]
    );
    if (owned.length > 0) {
      if (!transferOwnerTo) {
        return NextResponse.json(
          {
            error: "该成员名下存在组织项目，请指定接收人（transferOwnerTo）",
            projects: owned,
          },
          { status: 409 }
        );
      }
      if (
        !UUID_RE.test(transferOwnerTo) ||
        transferOwnerTo === params.userId
      ) {
        return NextResponse.json({ error: "接收人不合法" }, { status: 400 });
      }
      // 接收人必须是组织内其他成员
      const receiver = await query<{ id: string }>(
        "SELECT id FROM org_members WHERE org_id = $1 AND user_id = $2",
        [ctx.orgId, transferOwnerTo]
      );
      if (receiver.length === 0) {
        return NextResponse.json(
          { error: "接收人必须是组织内成员" },
          { status: 400 }
        );
      }
    } else {
      transferOwnerTo = undefined; // 无待交接项目，忽略传入值
    }
  }

  const sharesExist = await projectSharesExists();

  // 事务：owner 转移 → 删共享关系 → 删成员行（1.5）
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (hasOrgColumns && transferOwnerTo) {
      await client.query(
        `UPDATE projects SET owner_id = $1
          WHERE org_id = $2 AND owner_id = $3`,
        [transferOwnerTo, ctx.orgId, params.userId]
      );
    }
    if (sharesExist) {
      await client.query(
        "DELETE FROM project_shares WHERE org_id = $1 AND shared_with = $2",
        [ctx.orgId, params.userId]
      );
    }
    await client.query(
      "DELETE FROM org_members WHERE org_id = $1 AND user_id = $2",
      [ctx.orgId, params.userId]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // 历史痕迹（judgments / comments / reports 的 user_id）保留不动：
  // 这是作者史实，不是职责归属（架构文档 1.5）。
  return NextResponse.json({ ok: true });
}
