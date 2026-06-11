// 服务端机构权限校验与能力位（架构文档 v1.1 第 1.3 / 1.4 节）
//
// 双重防护策略（参照 adminAuth.ts）：
//   1) middleware (Edge) 用 JWT token.orgId 做快路径拦截
//   2) 本文件函数在 Node 运行时直接查 DB（org_members 现取），
//      避免 token 缓存假阳性（如成员被移出后 token 还没刷新）
//
// 能力位原则（红线）：代码只认能力位，不认版本名。
// 唯一合法判断形式是 hasCapability / getCapabilityNumber，
// 不允许出现 if (plan === '协作版') 类判断。
//
// 缓存策略：
//   - 成员关系（谁在哪个 org、什么角色）= 安全边界，每请求查库，不缓存
//   - capabilities = 功能开关，内存缓存 + 30s TTL（错 30s 无安全后果）；
//     平台 admin 修改 capabilities 的路由会调用 invalidateOrgCapabilities
//     主动清缓存，使变更即时生效

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export type OrgRole = "admin" | "partner" | "analyst";

export type Capabilities = Record<string, boolean | number>;

export interface OrgContext {
  orgId: string;
  role: OrgRole;
  capabilities: Capabilities;
  orgName: string;
  userId: string;
}

// ------------------------------------------------------------
// capabilities 内存缓存（30s TTL）
// 多实例部署时各实例独立缓存，TTL 内可能不一致——能力位是功能开关
// 而非安全边界（安全边界是 org_members 角色，每请求查库），可接受。
// ------------------------------------------------------------
const CAP_CACHE_TTL_MS = 30_000;
const capCache = new Map<string, { caps: Capabilities; expires: number }>();

// pg 在某些情况下会把 JSONB 列以字符串返回，统一解析为对象
function parseCapabilities(raw: unknown): Capabilities {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return {};
  const out: Capabilities = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "boolean" || typeof v === "number") out[k] = v;
  }
  return out;
}

function cacheCapabilities(orgId: string, caps: Capabilities): void {
  capCache.set(orgId, { caps, expires: Date.now() + CAP_CACHE_TTL_MS });
}

// 平台 admin 修改 capabilities / is_active 后调用，使变更即时生效
export function invalidateOrgCapabilities(orgId: string): void {
  capCache.delete(orgId);
}

export async function getOrgCapabilities(orgId: string): Promise<Capabilities> {
  const hit = capCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.caps;

  const rows = await query<{ capabilities: unknown }>(
    "SELECT capabilities FROM orgs WHERE id = $1 AND is_active = true",
    [orgId]
  );
  const caps = rows[0] ? parseCapabilities(rows[0].capabilities) : {};
  cacheCapabilities(orgId, caps);
  return caps;
}

// boolean 能力位：严格 === true 才算开启
export async function hasCapability(
  orgId: string,
  capability: string
): Promise<boolean> {
  const caps = await getOrgCapabilities(orgId);
  return caps[capability] === true;
}

// number 能力位（如 max_members）：缺省返回 0
export async function getCapabilityNumber(
  orgId: string,
  capability: string
): Promise<number> {
  const caps = await getOrgCapabilities(orgId);
  const v = caps[capability];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ------------------------------------------------------------
// 成员关系：每请求 DB 现取（安全边界）
// ------------------------------------------------------------

// 返回 null 表示当前用户无组织（或 org 已停用）→ 调用方走个人版逻辑。
// 迁移 020 未执行时（表不存在）静默返回 null，保证个人版零影响。
export async function getOrgContext(userId: string): Promise<OrgContext | null> {
  try {
    const rows = await query<{
      org_id: string;
      role: OrgRole;
      org_name: string;
      capabilities: unknown;
    }>(
      `SELECT m.org_id, m.role, o.name AS org_name, o.capabilities
         FROM org_members m
         JOIN orgs o ON o.id = m.org_id AND o.is_active = true
        WHERE m.user_id = $1
        LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    const capabilities = parseCapabilities(row.capabilities);
    // 顺带刷新能力位缓存（同一行数据，免一次 orgs 查询）
    cacheCapabilities(row.org_id, capabilities);
    return {
      orgId: row.org_id,
      role: row.role,
      capabilities,
      orgName: row.org_name,
      userId,
    };
  } catch {
    return null;
  }
}

// 角色级别：admin > partner > analyst
const ROLE_LEVEL: Record<OrgRole, number> = {
  admin: 3,
  partner: 2,
  analyst: 1,
};

function roleSatisfies(role: OrgRole, minRole?: "admin" | "partner"): boolean {
  if (!minRole) return true;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

async function checkOrg(
  minRole?: "admin" | "partner"
): Promise<{ ok: boolean; ctx?: OrgContext }> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };
  const ctx = await getOrgContext(userId);
  if (!ctx || !roleSatisfies(ctx.role, minRole)) return { ok: false, ctx: ctx ?? undefined };
  return { ok: true, ctx };
}

// 用于 (app)/org 下的 Server Component / layout / page：
// 无组织或角色不符 → redirect 到 /dashboard。
export async function requireOrg(
  minRole?: "admin" | "partner"
): Promise<OrgContext> {
  const r = await checkOrg(minRole);
  if (!r.ok || !r.ctx) redirect("/dashboard");
  return r.ctx;
}

// 用于 /api/org/* 路由：未登录 401，无组织/角色不符 403。
export async function requireOrgAPI(
  minRole?: "admin" | "partner"
): Promise<
  | { ok: true; ctx: OrgContext }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  const ctx = await getOrgContext(session.user.id);
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json({ error: "您不属于任何组织" }, { status: 403 }),
    };
  }
  if (!roleSatisfies(ctx.role, minRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, ctx };
}

// 能力位守门（API 路由用）：无组织 / 能力关闭 → 403
export async function requireCapabilityAPI(
  capability: string
): Promise<
  | { ok: true; ctx: OrgContext }
  | { ok: false; response: NextResponse }
> {
  const guard = await requireOrgAPI();
  if (!guard.ok) return guard;
  if (guard.ctx.capabilities[capability] !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "组织未开通该能力" },
        { status: 403 }
      ),
    };
  }
  return guard;
}
