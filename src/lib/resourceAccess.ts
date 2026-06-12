// src/lib/resourceAccess.ts —— 统一资源归属校验（架构文档 v1.1 第 2.3 / 4.4 节）
//
// 取代散落各 API 路由的 `WHERE user_id = $1` 模式。
// 规则：user_id 归属 OR (org_id 归属 AND 角色允许)。
//
// 核心保证（个人版零影响，本阶段最高验收标准）：
//   scope.org === null 时，所有函数返回与现状逐字节等价的 `user_id = $n`，
//   且 params 仅含 [userId]——无组织用户的 SQL 与改造前完全一致。

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrgContext, type OrgContext } from "@/lib/orgAuth";

export interface AccessScope {
  userId: string;
  org: OrgContext | null; // null = 个人版用户，走纯 user_id 路径
}

// assertProjectAccess 通过时返回的项目元信息（供子资源写入跟随 org_id 等）。
export interface ProjectAccessInfo {
  userId: string; // 项目创建者
  orgId: string | null; // 组织项目的 org_id；个人项目为 null
  ownerId: string | null;
}

export class ResourceForbiddenError extends Error {
  status: number;
  constructor(message = "无权访问该资源", status = 403) {
    super(message);
    this.name = "ResourceForbiddenError";
    this.status = status;
  }
}

// 把 ResourceForbiddenError 转成 NextResponse；其他异常照常抛出。
export function accessErrorResponse(e: unknown): NextResponse {
  if (e instanceof ResourceForbiddenError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

// 构造访问范围（每请求调用一次，传入后续所有 scoped 查询）。
export async function buildAccessScope(userId: string): Promise<AccessScope> {
  const org = await getOrgContext(userId);
  return { userId, org };
}

function isManager(role: OrgContext["role"]): boolean {
  return role === "admin" || role === "partner";
}

// 给列名加可选别名前缀（projects 表在部分查询中别名为 p）
function col(alias: string | undefined, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

// ------------------------------------------------------------
// 生成 projects 表的可见性 WHERE 片段。
//   个人版（scope.org === null）：`user_id = $n`，params [userId]（与现状等价）。
//   机构版 partner/admin：`(user_id = $n OR org_id = $n+1)`。
//   机构版 analyst：`(user_id = $n OR (org_id = $n+1 AND
//       (owner_id = $n OR id IN (SELECT project_id FROM project_shares
//                                 WHERE shared_with = $n))))`。
// startIndex 为本片段第一个占位符编号（$n）。
// ------------------------------------------------------------
export function scopedProjectWhere(
  scope: AccessScope,
  startIndex: number,
  opts?: { alias?: string }
): { sql: string; params: unknown[] } {
  const a = opts?.alias;
  const uidCol = col(a, "user_id");

  if (!scope.org) {
    return { sql: `${uidCol} = $${startIndex}`, params: [scope.userId] };
  }

  const n = startIndex; // userId
  const m = startIndex + 1; // orgId
  const orgCol = col(a, "org_id");
  const ownerCol = col(a, "owner_id");
  const idCol = col(a, "id");

  if (isManager(scope.org.role)) {
    return {
      sql: `(${uidCol} = $${n} OR ${orgCol} = $${m})`,
      params: [scope.userId, scope.org.orgId],
    };
  }

  // analyst：仅自己 owner 的 + 被显式共享的
  const sql =
    `(${uidCol} = $${n} OR (${orgCol} = $${m} AND ` +
    `(${ownerCol} = $${n} OR ${idCol} IN ` +
    `(SELECT project_id FROM project_shares WHERE shared_with = $${n}))))`;
  return { sql, params: [scope.userId, scope.org.orgId] };
}

// ------------------------------------------------------------
// 生成"可见性跟随项目"的子资源 WHERE 片段
// （reports / documents / meeting_notes / post_investment_updates /
//   investment_judgments 的项目级读取）。
//   个人版：`user_id = $n`（与现状等价）。
//   机构版：`(user_id = $n OR (org_id = $n+1 AND project_id IN (<可见项目子查询>)))`。
//   excludeMergedForAnalyst：reports 表专用，analyst 角色时追加
//     `AND kind <> 'committee'`，排除投委会总报告行（1.2 矩阵）。
// ------------------------------------------------------------
export function scopedProjectChildWhere(
  scope: AccessScope,
  startIndex: number,
  opts?: {
    alias?: string;
    projectIdColumn?: string;
    excludeMergedForAnalyst?: boolean;
  }
): { sql: string; params: unknown[] } {
  const a = opts?.alias;
  const uidCol = col(a, "user_id");

  if (!scope.org) {
    return { sql: `${uidCol} = $${startIndex}`, params: [scope.userId] };
  }

  const n = startIndex; // userId
  const m = startIndex + 1; // orgId
  const orgCol = col(a, "org_id");
  const pidCol = col(a, opts?.projectIdColumn ?? "project_id");
  const orgId = scope.org.orgId;

  // 可见项目子查询（与 scopedProjectWhere 同一规则，但只取 id 列、不带别名）
  let visibleProjects: string;
  if (isManager(scope.org.role)) {
    visibleProjects = `SELECT id FROM projects WHERE org_id = $${m}`;
  } else {
    visibleProjects =
      `SELECT id FROM projects WHERE org_id = $${m} AND ` +
      `(owner_id = $${n} OR id IN ` +
      `(SELECT project_id FROM project_shares WHERE shared_with = $${n}))`;
  }

  let sql =
    `(${uidCol} = $${n} OR (${orgCol} = $${m} AND ${pidCol} IN (${visibleProjects})))`;

  // analyst 不可见投委会总报告（kind='committee'，含他人判断内容）
  if (opts?.excludeMergedForAnalyst && scope.org.role === "analyst") {
    sql = `(${sql} AND ${col(a, "kind")} <> 'committee')`;
  }

  return { sql, params: [scope.userId, orgId] };
}

// ------------------------------------------------------------
// 单资源归属断言（写操作前调用）。
// 不可见/不可写时抛 ResourceForbiddenError（status 403 或 404）。
// 角色规则按 1.2 矩阵集中实现，路由里不再写散装角色 if。
// ------------------------------------------------------------
export async function assertProjectAccess(
  scope: AccessScope,
  projectId: string,
  action: "read" | "write" | "delete"
): Promise<ProjectAccessInfo> {
  const rows = await query<{
    user_id: string;
    org_id: string | null;
    owner_id: string | null;
  }>(
    "SELECT user_id, org_id, owner_id FROM projects WHERE id = $1",
    [projectId]
  );
  const proj = rows[0];
  if (!proj) throw new ResourceForbiddenError("项目不存在", 404);

  const info: ProjectAccessInfo = {
    userId: proj.user_id,
    orgId: proj.org_id,
    ownerId: proj.owner_id,
  };

  // 个人项目（org_id IS NULL）：仅创建者本人可访问（个人版语义，零变化）。
  if (!proj.org_id) {
    if (proj.user_id === scope.userId) return info;
    throw new ResourceForbiddenError("无权访问该项目", 404);
  }

  // 组织项目：必须是同组织成员。
  if (!scope.org || scope.org.orgId !== proj.org_id) {
    throw new ResourceForbiddenError("无权访问该项目", 404);
  }

  const role = scope.org.role;
  const isOwner = proj.owner_id === scope.userId;

  // partner/admin 对组织项目全可见全可写；删除时 partner 仅自己 owner 的。
  if (isManager(role)) {
    if (action === "delete" && role === "partner" && !isOwner) {
      throw new ResourceForbiddenError("仅可删除自己负责的项目");
    }
    return info;
  }

  // analyst：仅 owner 的 + 被共享的。
  if (isOwner) return info;

  if (action === "read" || action === "write") {
    const shared = await query<{ project_id: string }>(
      "SELECT project_id FROM project_shares WHERE project_id = $1 AND shared_with = $2",
      [projectId, scope.userId]
    );
    if (shared[0]) return info; // 共享 = 可见+可编辑（4.4）
  }

  throw new ResourceForbiddenError("无权访问该项目", 404);
}
