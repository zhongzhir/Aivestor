# Aivestor 机构版架构设计文档

> 版本：v1.1（2026-06-11）
> 状态：设计定稿（已完成 v1 评审修订），待按路线图分批实施
> 范围：本文档是机构版全部功能的总蓝图。所有实施任务以本文档为准拆分。

## 修订记录

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| v1.1 | 2026-06-11 | ① 堵住权限矩阵漏洞：投委会总报告查看权限提升为 partner+，引入 `reports.kind='committee'` 结构化标识（1.2 / 2.3 / 4.3 / 迁移 023）；② `org_invitations` 三列 UNIQUE 改为 pending 部分唯一索引（迁移 020）；③ 修正 7.3 LP 报告 project_id 约束的自相矛盾表述，明确放宽 NOT NULL + 应用层不变量（迁移 026）；④ 新增 1.5「成员移出与资产交接」（owner 转移、共享清理、409 引导）；⑤ 1.4 增加 jwt callback 重复查询的性能标记（不改设计）；⑥ `zjjr_features` ivfflat 索引改为首次全量导入后由同步服务创建（迁移 024 / 5.2 / P5 验收） |
| v1 | 2026-06-11 | 初版（commit `f3fdfc2`） |

---

## 0. 现状基线（设计依据）

本设计基于对现有代码的实际阅读，关键事实如下（后续所有设计都落在这些约束上）：

| 现有机制 | 位置 | 与机构版的关系 |
|---|---|---|
| NextAuth JWT 会话，token 携带 `uid` + `plan` | `src/lib/auth.ts`（`jwt`/`session` callback） | org_id / org_role 注入点 |
| Edge middleware 快路径 + Node 层 DB 现取的 admin 双层校验 | `src/middleware.ts` + `src/lib/adminAuth.ts` | 机构鉴权直接复制此模式 |
| 所有资源端点按 `WHERE user_id = $1` 校验归属 | `src/app/api/**` 各路由 | 第二部分统一改造对象 |
| prompt 注入链：`injectProfile` 前置画像 | `src/lib/user-profile.ts:136`，14 处路由调用 | 第八部分新注入函数并联点 |
| 对话记忆三段注入：画像 + 沉淀 + 知识库检索 | `src/lib/memoryContext.ts` | 三层检索的改造基础 |
| SKILL 运行框架：模板变量替换 + 流式 | `src/app/api/skills/run/route.ts` | 机构版无需改框架，仅改归属校验 |
| 投委会总报告：多报告合并，标题前缀【总报告】 | `src/app/api/projects/[id]/reports/merge/route.ts` | 第四部分多人判断聚合扩展点 |
| 报告类型 `reports.kind`：analysis / brief / term_sheet | `db/migrations/018_reports_kind.sql` | LP 报告新增 kind |
| admin 统计：服务端直查 + `Promise.all` 聚合 | `src/app/admin/dashboard/page.tsx` | 机构 Dashboard 复用此模式 |
| docx 导出 | `src/lib/export.ts`、`/api/reports/[id]/export` | LP 报告导出直接复用 |
| 向量检索：百炼 embedding 1536 维 + ivfflat，全文检索兜底 | `src/lib/embedding.ts`、`src/lib/memoryContext.ts` | 三层检索与 zjjr 表沿用同一向量方案 |
| 迁移序列：当前最大编号 019，且 016–019 存在重号 | `db/migrations/` | 机构版迁移从 **020** 起，严格单调编号 |

**生产迁移纪律（历史事故教训）**：metadata 列未迁移先上代码曾导致线上 500。本文档所有迁移 SQL 单独成文件；**任何依赖新字段的代码，必须在迁移于生产库手动执行完成之后才能部署**。每个实施任务的验收标准都包含"迁移先行"检查项。

---

## 第一部分：组织与权限层

机构版所有功能的地基。本部分无任何外部依赖，必须最先实施。

### 1.1 新增表（迁移 `db/migrations/020_orgs_and_members.sql`）

```sql
-- ============================================================
-- 迁移 020：组织与成员 — 机构版地基
-- 幂等：可重复执行。
-- 依赖：set_updated_at() 函数（schema.sql 已创建）。
-- ============================================================

CREATE TABLE IF NOT EXISTS orgs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  -- 能力位：代码只认这里的开关，不认任何版本名（见 1.3）
  capabilities  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 组织简介 / 备注（机构档案页展示用）
  description   TEXT,
  -- 组织 logo（对象存储路径，复用 documents.file_url 同一存储）
  logo_url      TEXT,
  -- 软停用：到期 / 违约时置 false，所有 org 功能立即不可用
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_orgs_updated
  BEFORE UPDATE ON orgs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS org_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'analyst'
                  CHECK (role IN ('admin', 'partner', 'analyst')),
  -- 邀请人（追溯用，可空：首个 admin 无邀请人）
  invited_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- 一人一 org（初期硬约束，见 1.1.1 说明；放开多 org 时仅需删本索引）
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_single_org
  ON org_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);

CREATE OR REPLACE TRIGGER trg_org_members_updated
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 邀请表：admin 生成邀请（按邮箱/手机号），被邀请人登录后接受
CREATE TABLE IF NOT EXISTS org_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- 邀请标识：邮箱或手机号（与 users.email / 手机登录体系对应）
  identifier    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'analyst'
                  CHECK (role IN ('admin', 'partner', 'analyst')),
  invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一组织对同一身份同时只能有一条待处理邀请；
-- 历史状态行（revoked / expired / accepted）不限量。
-- 注意不能用 UNIQUE (org_id, identifier, status)：同一身份第二次被撤销/
-- 过期时会与既有 revoked / expired 行冲突。
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_pending
  ON org_invitations(org_id, identifier) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invitations_identifier
  ON org_invitations(identifier, status);
```

#### 1.1.1 一人一 org 还是多 org？——结论：初期一人一 org

**建议**：用 `idx_org_members_single_org` 唯一索引硬性约束一个用户只属于一个组织。理由：

1. **JWT 简单**：token 只需一个 `orgId` 字段，无需"当前激活组织"切换状态，session callback 与 middleware 改动最小。
2. **归属校验简单**：统一归属函数（第二部分）只需比对单个 org_id，不需要 `org_id = ANY($ids)`。
3. **真实场景吻合**：目标客户是中小 VC/FA 团队，成员跨机构兼职是例外不是常态；FA 顾问多机构服务可以用多账号解决。
4. **可逆**：放开时只需删掉该唯一索引 + 把 JWT 的 `orgId` 改为 `orgIds[]` + 增加"当前组织"切换 UI，存量数据无需迁移。

`users.plan` 不变动：个人版用户 `plan='personal'` 且无 org_members 记录；机构成员的个人身份仍由 plan 表达（与计费解耦），机构能力完全由 org_members + orgs.capabilities 决定。**不新增 `plan='org'` 之类的值**——这正是能力位纯洁性原则的体现。

### 1.2 角色权限矩阵

三档角色：`admin`（管成员/配置/计费）、`partner`（看全部项目、参与投委会）、`analyst`（管自己负责的项目）。

操作符号：✅ 允许 ｜ 🔶 受限（见备注） ｜ ❌ 禁止。"组织项目"指 `projects.org_id = 本org` 的项目。

| 资源 | 操作 | admin | partner | analyst | 备注 |
|---|---|---|---|---|---|
| 项目 | 创建组织项目 | ✅ | ✅ | ✅ | 创建者自动成为 owner |
| 项目 | 查看 | ✅ 全部 | ✅ 全部 | 🔶 | analyst 仅 owner 是自己的 + 被共享的（4.4） |
| 项目 | 编辑/推进阶段 | ✅ 全部 | ✅ 全部 | 🔶 | analyst 仅自己 owner 的 |
| 项目 | 删除 | ✅ | 🔶 仅自己 owner 的 | 🔶 仅自己 owner 的 | |
| 项目 | 转移 owner | ✅ | 🔶 仅自己 owner 的 | ❌ | |
| 报告 | 生成/修改 | ✅ | ✅ | 🔶 | 范围跟随项目可见性 |
| 报告 | 普通报告查看/导出（analysis / brief / term_sheet / SKILL 分析） | ✅ | ✅ | 🔶 | 跟随项目可见性 |
| 报告 | 投委会总报告查看/导出（merge 产物，`kind='committee'`） | ✅ | ✅ | ❌ | 含他人判断内容（合伙人观点对比），查看权限提升为 partner+，与生成权限对齐——否则 analyst 经自己 owner/被共享项目的总报告可绕穿「看他人判断 ❌」 |
| 报告 | 投委会总报告生成（多人判断聚合） | ✅ | ✅ | ❌ | 投委会是 partner 以上职能 |
| 判断 | 写自己的判断 | ✅ | ✅ | ✅ | judgments 永远 user_id 归属，他人不可改 |
| 判断 | 看他人判断 | ✅ | ✅ | ❌ | 仅在投委会聚合视图（4.3）内可见 |
| 知识库 | 个人层读写 | ✅ | ✅ | ✅ | org 内默认私有（第三部分） |
| 知识库 | 晋升条目到机构层 | ✅ | ✅ | ✅ | 显式分享动作（3.4） |
| 知识库 | 机构层读 | ✅ | ✅ | ✅ | 全员可读是"机构沉淀"的意义所在 |
| 知识库 | 机构层删/撤回 | ✅ 任意条目 | 🔶 自己晋升的 | 🔶 自己晋升的 | |
| SKILL | 运行 catalog/个人自建 | ✅ | ✅ | ✅ | 现有行为不变 |
| SKILL | 组织共享 SKILL 增删 | ✅ | ✅ | ❌ | `user_custom_skills.org_id`（第二部分） |
| SKILL | 组织共享 SKILL 运行 | ✅ | ✅ | ✅ | |
| 数据应用 | 访问（需 `zjjr_data` 能力位） | ✅ | ✅ | ✅ | 能力位是组织级开关，角色不再细分 |
| 机构 Dashboard | 查看 | ✅ | ✅ | ❌ | 含成员活跃度，仅管理层可见 |
| LP 报告 | 生成/导出 | ✅ | ✅ | ❌ | |
| 组织设置 | 成员邀请/移除/改角色 | ✅ | ❌ | ❌ | |
| 组织设置 | 改组织名/logo | ✅ | ❌ | ❌ | |
| 组织设置 | 查看能力位/套餐状态 | ✅ | ❌ | ❌ | capabilities 本身只读，修改走平台 admin |

平台超级管理员（`users.plan='admin'`，现有 admin 后台）新增职责：创建 org、调整 org.capabilities、停用 org。机构 admin **不能**修改自己的 capabilities。

### 1.3 能力位（capability flags）机制 —— 核心设计

#### 硬性原则（写入工程规范，code review 红线）

> **代码只认能力位，不认版本名。** 版本（协作版/数据增强版）是能力包的市场别名，由销售与产品材料使用。代码库中不允许出现任何 `if (plan === '协作版')`、`if (org.tier === 'pro')` 类判断；唯一合法判断形式是 `hasCapability(orgId, 'xxx')` 与 `getCapabilityNumber(orgId, 'max_members')`。新增能力一律加能力位，不加版本枚举。

#### 能力位清单（首批）

| 能力位 | 类型 | 含义 | 守门的功能 |
|---|---|---|---|
| `collaboration` | boolean | 组织协作 | 组织项目、owner/共享、项目评论、多人判断聚合 |
| `org_knowledge` | boolean | 机构知识沉淀层 | 知识晋升、机构层检索注入 |
| `org_dashboard` | boolean | 机构统计分析 | Dashboard、机构档案统一视图 |
| `lp_reports` | boolean | LP 报告 | lp_report 生成与导出 |
| `assoc_report` | boolean | 协会报告辅助 | 信息聚合底稿 |
| `zjjr_data` | boolean | 中鉴数据增强 | 数据应用入口、中鉴层检索注入、injectMarketContext |
| `data_apps` | boolean | 数据应用框架入口 | 「数据应用」导航（与 zjjr_data 分开，便于未来接非中鉴数据源的应用） |
| `max_members` | number | 成员数上限 | 邀请接口校验 |

#### 三个预设能力包（市场别名 → 能力位映射，仅存在于运营文档与 admin 后台预设按钮，不存在于业务代码）

| 能力位 | 个人版 | 机构协作版 | 机构数据增强版 |
|---|---|---|---|
| （无 org） | ✅ 不适用，capabilities 整体不参与 | — | — |
| `collaboration` | — | true | true |
| `org_knowledge` | — | true | true |
| `org_dashboard` | — | true | true |
| `lp_reports` | — | true | true |
| `assoc_report` | — | true | true |
| `zjjr_data` | — | **false** | true |
| `data_apps` | — | false | true |
| `max_members` | — | 10 | 30 |

机构协作版 JSONB 示例（admin 后台"应用协作版预设"按钮写入的值）：

```json
{"collaboration": true, "org_knowledge": true, "org_dashboard": true,
 "lp_reports": true, "assoc_report": true,
 "zjjr_data": false, "data_apps": false, "max_members": 10}
```

#### `hasCapability` 实现方案

新文件 `src/lib/orgAuth.ts`（与 `adminAuth.ts` 并列）：

```typescript
// src/lib/orgAuth.ts —— 机构鉴权与能力位（双层模式，参照 adminAuth.ts）

export interface OrgContext {
  orgId: string;
  role: "admin" | "partner" | "analyst";
  capabilities: Record<string, boolean | number>;
  orgName: string;
}

// 内存缓存 + 短 TTL：orgs.capabilities 读多写极少（仅平台 admin 改套餐时变）
// TTL 30s：套餐调整最长 30s 生效，可接受；进程重启自然失效。
// 注意：多实例部署时各实例独立缓存，30s 内可能不一致——能力位是
// 功能开关而非安全边界（安全边界是 org_members 角色，每请求查库），可接受。
const capCache = new Map<string, { caps: Record<string, boolean | number>; expires: number }>();
const CAP_CACHE_TTL_MS = 30_000;

export async function getOrgCapabilities(
  orgId: string
): Promise<Record<string, boolean | number>>;

export async function hasCapability(
  orgId: string,
  capability: string
): Promise<boolean>;          // boolean 位：=== true；数字位用下面的函数

export async function getCapabilityNumber(
  orgId: string,
  capability: string
): Promise<number>;           // 缺省返回 0

// 每请求 DB 现取成员关系（安全边界，不缓存）：
// 返回 null 表示当前用户无组织 → 调用方走个人版逻辑
export async function getOrgContext(userId: string): Promise<OrgContext | null>;

// 用于 Server Component / layout：无组织或角色不符 → redirect("/dashboard")
export async function requireOrg(minRole?: "admin" | "partner"): Promise<OrgContext>;

// 用于 API 路由：返回 403 NextResponse 或 OrgContext
export async function requireOrgAPI(minRole?: "admin" | "partner"): Promise<
  | { ok: true; ctx: OrgContext }
  | { ok: false; response: NextResponse }
>;

// 能力位守门（API 路由用）：无组织 / 能力关闭 → 403
export async function requireCapabilityAPI(capability: string): Promise<
  | { ok: true; ctx: OrgContext }
  | { ok: false; response: NextResponse }
>;
```

`getOrgContext` 的核心查询（一条 JOIN，成员关系与能力位一次取回；能力位部分走缓存时退化为只查 org_members）：

```sql
SELECT m.org_id, m.role, o.name AS org_name, o.capabilities
  FROM org_members m
  JOIN orgs o ON o.id = m.org_id AND o.is_active = true
 WHERE m.user_id = $1
 LIMIT 1
```

**缓存策略结论**：成员关系（谁在哪个 org、什么角色）**每请求查库**——这是安全边界，参照 adminAuth 的"DB 现取为准"原则；capabilities **内存缓存 + 30s TTL**——它是功能开关，错 30s 无安全后果，且省掉绝大多数 orgs 表查询。不用 session 缓存（JWT 不可控的过期时机，见 1.4）。

**调用位置结论**：业务函数内不做能力判断；统一在 **API route 层入口**调用 `requireCapabilityAPI` / `requireOrgAPI`，与现有 `requireAdminAPI` 的使用位置一致。页面层（Server Component）用 `requireOrg` + `hasCapability` 控制导航与入口渲染。

### 1.4 鉴权链路

参照现有 admin 双层模式（`src/middleware.ts` JWT 快路径 + `src/lib/adminAuth.ts` DB 现取）：

#### JWT 注入什么

`src/lib/auth.ts` 的 `jwt` callback 在现有 `token.uid` / `token.plan` 之外新增：

```typescript
// jwt callback 内，user 首次登录分支：
const orgRows = await query<{ org_id: string; role: string }>(
  "SELECT org_id, role FROM org_members WHERE user_id = $1",
  [dbUserId]
);
if (orgRows[0]) {
  token.orgId = orgRows[0].org_id;
  token.orgRole = orgRows[0].role;
}
```

`session` callback 同步透出 `session.user.orgId` / `session.user.orgRole`，供前端做 UI 切换（与现有 `plan` 透出方式一致，`src/lib/auth.ts:186-195`）。

**capabilities 不进 token。理由**：
1. **失效不可控**：JWT 只在登录时写入；平台 admin 调整套餐后，已登录成员的 token 不会刷新——付费升级要重登才生效是不可接受的体验（admin 升级需重登的已知问题不应复制到付费链路上）。
2. **token 膨胀**：capabilities 会持续增长，JWT 进 cookie，每请求都背着它。
3. **有更好的替代**：capabilities 读取走 `getOrgCapabilities` 的 30s 内存缓存，成本接近零且 30s 内全局生效。

#### middleware 层与 API 层的职责边界

| 层 | 职责 | 不做什么 |
|---|---|---|
| `src/middleware.ts`（Edge） | ① 未登录重定向（现有 withAuth）；② `/org/:path*` 加入 matcher，用 `token.orgId` 存在性做快路径拦截（无组织 → 302 /dashboard） | 不查 DB、不判角色细节、不判能力位（Edge 拿不到可靠数据） |
| API / Server Component（Node） | `requireOrgAPI` / `requireOrg` 每请求 DB 现取成员关系 + 角色 + 能力位，**以此为准** | 不信任 token.orgId / token.orgRole 做任何写操作授权 |

middleware 改动（在现有 admin 分支旁并列）：

```typescript
if (req.nextUrl.pathname.startsWith("/org")) {
  const orgId = (req.nextauth.token as { orgId?: string } | null)?.orgId;
  if (!orgId) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
}
```

matcher 数组追加 `"/org/:path*"`。

#### 移出组织 / 角色变更的生效时机

现有已知问题：admin 升级需重登（token.plan 过期）。机构版方案：

- **安全性即时生效**：所有 API 与 Server Component 的授权都来自 `getOrgContext` 每请求查库。用户被移出组织后，**下一个请求即被拒**——token 里残留的 orgId 只会让他多看到一次 302（middleware 放行 → Node 层拒绝），不会泄露任何数据。
- **UI 最终一致**：导航栏等依赖 session.orgId 的纯展示在 token 自然刷新前可能残留入口，点进去即被 Node 层拦截。
- **主动收敛（实施于成员管理接口内）**：`DELETE /api/org/members/[userId]` 与角色变更接口执行后，受影响用户的 token 在下次 NextAuth session 轮换时更新；同时 `jwt` callback 增加一个轻量改进——**每次 callback 都重读 org_members**（该 callback 仅在 session 校验时触发，频率可控；查询是主键级索引命中）：

```typescript
// jwt callback 末尾（user 为空的后续请求也执行）：
if (token.uid) {
  const rows = await query<{ org_id: string; role: string }>(
    "SELECT org_id, role FROM org_members WHERE user_id = $1",
    [token.uid as string]
  );
  token.orgId = rows[0]?.org_id;
  token.orgRole = rows[0]?.role;
}
```

这同时顺带修复了 admin 模式的同类问题模板：**token 仅作快路径与 UI 提示，授权永远 DB 现取**——和 adminAuth 现行注释声明的原则完全一致，机构版只是把这个原则执行得更彻底。

成员被移出时其名下组织资产（owner 项目、共享关系）的交接流程见 1.5。

> **性能标记（不改设计）**：jwt callback 与 `getOrgContext` 在同一请求路径上会各查一次 org_members（且前端 `useSession` 轮询也会触发 jwt callback）。安全以 Node 层 `getOrgContext` 为准，当前单 ECS 低并发规模下重复查询无感，接受现状。若将来成为热点，优化方向是 token 内记 `orgCheckedAt` 时间戳、距上次检查超过 60s 才重读 org_members。**实施 P1 时在 `src/lib/auth.ts` 对应位置留 TODO 注释。**

#### 第一部分新增 API 路由清单

| 方法 | 路径 | 用途 | 权限 |
|---|---|---|---|
| GET | `/api/org` | 当前用户的组织信息（含角色、能力位摘要） | 任意成员 |
| PATCH | `/api/org` | 改组织名/简介/logo | org admin |
| GET | `/api/org/members` | 成员列表 | 任意成员 |
| PATCH | `/api/org/members/[userId]` | 改角色 | org admin |
| DELETE | `/api/org/members/[userId]` | 移除成员（含资产交接，见 1.5） | org admin |
| POST | `/api/org/invitations` | 发出邀请（校验 max_members） | org admin |
| GET | `/api/org/invitations` | 邀请列表 | org admin |
| DELETE | `/api/org/invitations/[id]` | 撤销邀请 | org admin |
| GET | `/api/org/invitations/mine` | 我收到的待处理邀请 | 登录用户 |
| POST | `/api/org/invitations/[id]/accept` | 接受邀请（写 org_members） | 被邀请人 |
| POST | `/api/admin/orgs` | 平台创建 org + 指定首个 admin | 平台 admin |
| GET | `/api/admin/orgs` | org 列表 | 平台 admin |
| PATCH | `/api/admin/orgs/[id]` | 调整 capabilities / is_active | 平台 admin |

页面：`src/app/(app)/org/settings/page.tsx`（组织设置，admin 可见成员管理 tab）、`src/app/admin/orgs/page.tsx`（平台 org 管理，复用现有 admin 布局）。

### 1.5 成员移出与资产交接

`DELETE /api/org/members/[userId]` 不允许产生"幽灵 owner"（owner_id 指向已不在组织内的用户，会污染 analyst 可见性判定、Dashboard 成员活跃度统计与 owner 筛选下拉）。流程：

1. **前置校验**：查 `SELECT id, name FROM projects WHERE org_id = $org AND owner_id = $leaving`。存在待交接项目时：
   - 请求体携带 `transferOwnerTo`（必须校验为组织内其他成员）→ 事务内执行：

```sql
BEGIN;
UPDATE projects SET owner_id = $transferOwnerTo
 WHERE org_id = $org AND owner_id = $leaving;
DELETE FROM project_shares
 WHERE org_id = $org AND shared_with = $leaving;
DELETE FROM org_members
 WHERE org_id = $org AND user_id = $leaving;
COMMIT;
```

   - 未携带 `transferOwnerTo` → 返回 **409**，响应体含待交接项目清单（`{ projects: [{ id, name }] }`），前端弹窗引导 org admin 选择接收人后重试。
2. **历史痕迹保留不动**：被移出成员的 judgments / project_comments / reports 的 `user_id` 不变——这是作者史实，不是职责归属；仅 owner 职责转移。
3. **共享关系清理**：`project_shares` 中 `shared_with = 该成员` 的行随同一事务删除（人已不在组织，共享关系无意义）；该成员名下无 owner 项目时，事务退化为"删共享 + 删成员"两条语句。

### 2.1 逐表确认

原则：`org_id IS NULL` = 个人资产（现状），有值 = 机构资产。个人版行为完全不变。

| 表 | 加 org_id？ | 说明 |
|---|---|---|
| `projects` | ✅ | 组织项目的根。同时加 `owner_id`（第四部分） |
| `documents` | ✅ | 跟随项目；独立上传到机构知识库的文档也需 org 归属 |
| `knowledge_base_entries` | ✅ | 机构沉淀层载体（第三部分，另加 visibility） |
| `reports` | ✅ | 组织项目的报告组织内按角色可见 |
| `investment_judgments` | ✅ | **judgment 永远 user_id 私有**；org_id 仅用于"这是组织项目下的判断"标记，供投委会聚合检索（不改变可见性规则，见 1.2 矩阵） |
| `meeting_notes` | ✅ | 跟随项目 |
| `post_investment_updates` | ✅ | LP 报告聚合数据源 |
| `conversations` | ❌ | 独立对话是强个人场景（含个人思考过程），机构版不共享对话。不加 |
| `user_custom_skills` | ✅ | org_id 有值 = 组织共享 SKILL，全员可运行（1.2 矩阵） |
| `user_skills` | ❌ | 外部技能收藏夹，个人行为，不加 |
| `user_profiles` | ❌ | 投资人个人画像，定义上属于人不属于机构 |
| `skill_catalog` | ❌ | 平台官方目录，无归属概念 |

### 2.2 迁移 SQL（`db/migrations/021_org_resource_columns.sql`）

```sql
-- ============================================================
-- 迁移 021：存量资源表 org 化
-- 依赖：迁移 020（orgs 表）。
-- 幂等：可重复执行。
-- 个人版零影响：所有列 NULL 默认，存量行为 org_id IS NULL，
--   现有 WHERE user_id = $1 查询不受任何影响。
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE post_investment_updates
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE user_custom_skills
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

-- 部分索引：只索引机构行，个人行（org_id IS NULL，存量绝大多数）零索引开销
CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_owner
  ON projects(org_id, owner_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_org
  ON documents(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_org
  ON knowledge_base_entries(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_org
  ON reports(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_judgments_org_project
  ON investment_judgments(org_id, project_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_org
  ON meeting_notes(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_updates_org
  ON post_investment_updates(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_skills_org
  ON user_custom_skills(org_id) WHERE org_id IS NOT NULL;
```

**对现有查询的影响评估**：所有列均 `NULL` 可空、无默认值回填、无 NOT NULL 约束，纯 ADD COLUMN 是 PostgreSQL 的 catalog-only 操作（不重写表、不长锁）。现有全部 `WHERE user_id = $1` 查询语义不变（个人资产 org_id 为 NULL，依旧按 user_id 命中）。部分索引使个人版写入路径无新增索引维护成本。**唯一注意**：`SELECT *` 风格的查询会多出 org_id 列——经查代码库所有查询均显式列字段，无 `SELECT *`，无影响。

### 2.3 统一归属校验函数（替代散落各处的 `WHERE user_id = $1`）

新文件 `src/lib/resourceAccess.ts`：

```typescript
// src/lib/resourceAccess.ts —— 统一资源归属校验
// 取代散落各 API 路由的 WHERE user_id = $1 模式。
// 规则：user_id 归属 OR (org_id 归属 AND 角色允许)。

import { getOrgContext, type OrgContext } from "@/lib/orgAuth";

export type OrgVisibility =
  | "none"        // 该资源不开放组织可见（如 conversations）
  | "org_all"     // partner/admin 全可见，analyst 仅 owner/共享（projects 类）
  | "follow_project"; // 可见性跟随所属项目（reports / documents / meetings 等）

export interface AccessScope {
  userId: string;
  org: OrgContext | null;   // null = 个人版用户，走纯 user_id 路径
}

// 构造访问范围（每请求调用一次，传入后续所有 scoped 查询）
export async function buildAccessScope(userId: string): Promise<AccessScope>;

// 生成 SQL WHERE 片段与参数（追加到调用方的参数数组之后）。
// 个人版（scope.org === null）退化为 "user_id = $n" —— 与现状逐字节等价。
// 机构版（projects 表）展开为：
//   (user_id = $n
//     OR (org_id = $n+1 AND (
--          $role IN ('admin','partner')
--          OR owner_id = $n
--          OR id IN (SELECT project_id FROM project_shares WHERE shared_with = $n)
//        )))
export function scopedProjectWhere(
  scope: AccessScope,
  startIndex: number
): { sql: string; params: unknown[] };

// 跟随项目可见性的资源（reports/documents/meeting_notes/post_investment_updates/
// investment_judgments 的项目级读取）：
//   (user_id = $n OR (org_id = $n+1 AND project_id IN (<可见项目子查询>)))
export function scopedProjectChildWhere(
  scope: AccessScope,
  startIndex: number,
  opts?: {
    projectIdColumn?: string;
    // reports 表专用：scope 角色为 analyst 时追加 AND kind <> 'committee'，
    // 排除投委会总报告行（含他人判断内容，查看权限 partner+，见 1.2 矩阵）。
    // 识别字段为 reports.kind='committee'（结构化标识，迁移 023 引入，见 4.3——
    // 已查证现状 merge 产物仅有【总报告】标题前缀，kind 走默认 'analysis'，
    // 标题前缀不可作为权限过滤依据，故引入结构化 kind 值）。
    excludeMergedForAnalyst?: boolean;
  }
): { sql: string; params: unknown[] };

// 单资源归属断言（写操作前调用）：不可见/不可写时抛 ResourceForbiddenError
export async function assertProjectAccess(
  scope: AccessScope,
  projectId: string,
  action: "read" | "write" | "delete"
): Promise<void>;
```

实现要点：

- 个人版零影响由类型保证：`scope.org === null` 时所有函数返回与现状相同的 `user_id = $n`。
- 写操作（write/delete）的角色规则按 1.2 矩阵在 `assertProjectAccess` 内集中实现，路由里不再写角色 if。
- `project_shares` 表见第四部分 4.4。

#### 需要改造的 API 路由清单（将 `WHERE user_id = $1` 替换为 scoped 函数）

逐条核对现有 `src/app/api` 全部路由后的完整清单：

| 路由文件 | 改造内容 |
|---|---|
| `src/app/api/projects/route.ts` | 列表用 `scopedProjectWhere`；创建时若有 org 且 capability `collaboration`，写入 org_id + owner_id |
| `src/app/api/projects/[id]/documents/route.ts` | `assertProjectAccess` + 子表写入带 org_id |
| `src/app/api/projects/[id]/reports/route.ts` | 同上；列表查询带 `excludeMergedForAnalyst: true`（analyst 不见 `kind='committee'` 行） |
| `src/app/api/projects/[id]/reports/merge/route.ts` | 同上；按 4.3 扩展多人判断聚合，组织项目下 partner+ 才可调用；产物写 `kind='committee'` |
| `src/app/api/projects/[id]/judgments/route.ts` | 读：自己写的（org 项目下他人判断仅经 4.3 聚合接口出）；写：带 org_id |
| `src/app/api/projects/[id]/meetings/route.ts` | `assertProjectAccess` |
| `src/app/api/projects/[id]/meetings/[meetingId]/summarize/route.ts` | 同上 |
| `src/app/api/projects/[id]/updates/route.ts` | 同上（post_investment_updates） |
| `src/app/api/projects/[id]/outcome/route.ts` | 同上 |
| `src/app/api/projects/[id]/stage/route.ts` | 同上（write 权限） |
| `src/app/api/projects/[id]/decision/route.ts` | 同上 |
| `src/app/api/projects/[id]/term-sheet/route.ts` | 同上 |
| `src/app/api/projects/[id]/financials/route.ts` | 同上 |
| `src/app/api/projects/[id]/brief-analysis/route.ts` | 同上 |
| `src/app/api/projects/[id]/pending-questions/route.ts` | 同上 |
| `src/app/api/skills/run/route.ts` | `buildProjectVars` 内两处 `WHERE id=$1 AND user_id=$2` → `assertProjectAccess` + scoped 查询；user_custom_skills 读取放宽为 `(user_id=$2 OR org_id=$orgId)` |
| `src/app/api/skills/custom/route.ts`、`custom/[id]/route.ts` | 支持 org 共享 SKILL 的列出/创建（partner+） |
| `src/app/api/reports/[id]/refine/route.ts` | 报告归属 → `scopedProjectChildWhere`（带 `excludeMergedForAnalyst: true`） |
| `src/app/api/reports/[id]/export/route.ts`、`export-ppt/route.ts` | 同上（带 `excludeMergedForAnalyst: true`） |
| `src/app/api/reports/[id]/digest/route.ts` | 同上（带 `excludeMergedForAnalyst: true`） |
| `src/app/api/knowledge/route.ts` | 三层可见性（第三部分） |
| `src/app/api/knowledge/search/route.ts` | 换用统一三层检索入口（第三部分 3.3） |
| `src/app/api/knowledge/upload/route.ts` | 上传目标层选择（个人/机构） |
| `src/app/api/conversations/*` | **不改**（不开放组织可见） |
| `src/app/api/export/*` | 个人数据导出，**不改**（机构资产导出属机构 admin 功能，后续单列） |

改造方式为**机械替换 + 单元测试覆盖**：每个路由的改造前后，个人版用户（无 org）的 SQL 必须逐字节等价（scoped 函数退化路径保证）。

### 2.4 个人资产转入组织

**建议方案：支持单项目显式转入，不支持批量自动转入。**

- 入口：项目详情页（owner 本人）「转为组织项目」按钮 → `POST /api/projects/[id]/transfer-to-org`。
- 行为：一个事务内把该项目及其全部子资产打上 org_id，owner_id 置为操作者：

```sql
BEGIN;
UPDATE projects SET org_id = $org, owner_id = $uid
 WHERE id = $pid AND user_id = $uid AND org_id IS NULL;
UPDATE documents               SET org_id = $org WHERE project_id = $pid AND user_id = $uid;
UPDATE reports                 SET org_id = $org WHERE project_id = $pid AND user_id = $uid;
UPDATE investment_judgments    SET org_id = $org WHERE project_id = $pid AND user_id = $uid;
UPDATE meeting_notes           SET org_id = $org WHERE project_id = $pid AND user_id = $uid;
UPDATE post_investment_updates SET org_id = $org WHERE project_id = $pid AND user_id = $uid;
COMMIT;
```

- 知识库条目**不**随项目转移（个人判断层语义，见第三部分）；需要的条目走显式晋升。
- **不做反向操作**（组织项目转回个人）：避免 analyst 离职前"带走"项目的灰色操作；确需剥离由 org admin 删除或转 owner。
- 转入不可撤销需二次确认，确认文案注明"项目及其文档、报告、判断、会议记录将归属组织，组织管理层可见"。

---

## 第三部分：机构知识库三层架构

```
第一层：个人判断层  knowledge_base_entries (org_id IS NULL 或 visibility='private')
第二层：机构沉淀层  knowledge_base_entries (org_id = 本org AND visibility='org')
第三层：中鉴公共层  zjjr_features（独立表，物理隔离，只读）
```

### 3.1 前两层的承载（迁移 `db/migrations/022_org_knowledge_visibility.sql`）

```sql
-- ============================================================
-- 迁移 022：知识库可见性 — 机构沉淀层
-- 依赖：迁移 021（knowledge_base_entries.org_id）。
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'org'));

-- 晋升追溯：谁在何时把条目分享到机构层
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

-- 机构层检索索引（向量检索的 WHERE 过滤靠它收敛）
CREATE INDEX IF NOT EXISTS idx_kb_org_visible
  ON knowledge_base_entries(org_id, visibility)
  WHERE org_id IS NOT NULL AND visibility = 'org';
```

**不变量**（应用层与晋升接口共同维护）：`visibility='org'` ⇒ `org_id IS NOT NULL`。个人条目永远 `visibility='private'`（默认值即是，存量数据零回填）。条目**始终保留原 user_id**——机构层条目"作者"概念保留，撤回/删除权限按 1.2 矩阵。

### 3.2 隔离红线（写入工程规范，code review 红线）

> ① 用户/机构数据**永不写入**中鉴公共层：不存在任何从 knowledge_base_entries / 业务表到 `zjjr_*` 表的写路径；zjjr 表的唯一写入者是独立同步服务（第五部分），主应用对 `zjjr_*` 的数据库账号权限为 **SELECT only**（在部署文档中以 `GRANT SELECT ON zjjr_institutions, zjjr_investments, zjjr_features TO aivestor_app` 落实）。
> ② 中鉴层对 AI **只读**：注入链只检索不回写，AI 输出不回流 zjjr 表。

### 3.3 三层检索统一入口

新文件 `src/lib/knowledgeSearch.ts`（从 `memoryContext.ts` 的 `searchKnowledgeBase` 演化，原函数保留为个人版退化路径）：

```typescript
// src/lib/knowledgeSearch.ts —— 三层语义检索统一入口

export type KnowledgeLayer = "personal" | "org" | "zjjr";

export interface LayeredHit {
  layer: KnowledgeLayer;
  content: string;
  sourceType: string | null;   // 个人/机构层：kb.source_type；zjjr 层固定 "zjjr_feature"
  title: string | null;
  authorName: string | null;   // 机构层条目作者（org 内展示）；其余 null
  validUntil: string | null;   // 仅 zjjr 层（过期降权依据）
  similarity: number;          // 1 - 余弦距离
  weighted: number;            // similarity × 层权重 × 时效系数（排序依据）
}

export interface LayeredSearchOptions {
  topKPersonal?: number;  // 默认 5
  topKOrg?: number;       // 默认 5
  topKZjjr?: number;      // 默认 5（注入层硬上限，见第八部分）
}

export async function searchLayeredKnowledge(
  scope: AccessScope,            // 来自 resourceAccess，决定 org 层是否参与
  question: string,
  opts?: LayeredSearchOptions
): Promise<LayeredHit[]>;
```

实现要点：

1. **一次 embedding，三路并发查询**（`Promise.all`），各自 LIMIT topK：
   - 个人层：`WHERE user_id = $1 AND visibility = 'private' AND embedding IS NOT NULL ORDER BY embedding <=> $vec`（现有索引 `idx_kb_user` + ivfflat 命中；存量个人条目 visibility 默认 private，行为不变）；
   - 机构层：`WHERE org_id = $2 AND visibility = 'org' AND embedding IS NOT NULL ORDER BY embedding <=> $vec`（无 org 或无 `org_knowledge` 能力位时跳过）；
   - 中鉴层：`WHERE embedding IS NOT NULL ORDER BY embedding <=> $vec`（无 `zjjr_data` 能力位时跳过；查询 `zjjr_features` 表）。
2. **排序加权**：`weighted = similarity × layerWeight × freshness`。层权重：personal 1.0、org 0.95、zjjr 0.85（个人判断是产品核心价值，优先呈现）；时效系数仅 zjjr 层：`valid_until` 未过期 1.0，过期 0.5（降权不剔除，第五部分 5.5）。三路合并后按 weighted 降序。
3. **来源标注**：每条 hit 带 layer，注入与前端展示统一用 `【个人沉淀】/【机构沉淀】/【中鉴数据】` 前缀（第八部分文案）。
4. **降级路径**：与现状一致——embedding 不可用回退全文检索（个人/机构层用 `search_vector`，zjjr 层跳过），任何一路失败返回空数组不阻塞主流程。

`src/lib/memoryContext.ts` 的 `buildMemoryContext` 改为调用 `searchLayeredKnowledge`（个人版用户 scope.org=null，自动退化为现状单层检索）。`/api/knowledge/search` 同步换用。

### 3.4 知识晋升的写入路径

**结论：显式分享动作，不做 admin 审核。** 理由：目标团队规模 ≤30 人，信任前提下审核流是摩擦不是治理；已有 `promoted_by` 追溯 + admin 可删任意机构层条目（1.2 矩阵）作为事后治理手段，足够。

- 默认行为不变：一切沉淀（对话 digest、报告 digest、手动录入、文档切片）进个人层（`visibility='private'`）。
- 晋升入口（交互建议）：
  1. 知识库列表 / 条目详情：「分享到机构知识库」按钮（有 org 且 `org_knowledge` 能力位时显示）；
  2. 对话/报告 digest 完成的 toast 上带快捷晋升入口（沉淀刚生成时分享意愿最高）。
- 接口：`POST /api/knowledge/[id]/promote`（校验：条目 user_id 是本人 → 置 `org_id=本org, visibility='org', promoted_by, promoted_at`）；`POST /api/knowledge/[id]/demote`（撤回，条目作者或 org admin）。
- 晋升是**移动不是复制**：同一条目改可见性，避免双份向量与内容漂移。

---

## 第四部分：轻协作能力

明确不做：工作流引擎、审批流、站内消息系统。协作 = owner + 评论 + 多人判断聚合 + 最简共享。全部由 `collaboration` 能力位守门。

### 4.1 projects.owner_id

已包含在迁移 021。语义：项目负责人，analyst 可见性的判定依据。创建组织项目时 `owner_id = 创建者`；转移 owner 见 1.2 矩阵。`user_id` 保留为"创建者"原义不变（个人版语义零影响）。

### 4.2 项目评论（迁移 `db/migrations/023_collaboration.sql` 第 1 段）

```sql
-- ============================================================
-- 迁移 023：轻协作 — 项目评论 + 项目共享 + 投委会总报告 kind 标识
-- 依赖：迁移 021、018（reports.kind）。幂等：可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS project_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  -- 单层回复（不做无限嵌套）：指向被回复的顶层评论
  reply_to    UUID REFERENCES project_comments(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project
  ON project_comments(project_id, created_at DESC);

CREATE OR REPLACE TRIGGER trg_project_comments_updated
  BEFORE UPDATE ON project_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

仅组织项目可评论（org_id NOT NULL 强制）。路由：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/projects/[id]/comments` | 评论列表（项目可见者） |
| POST | `/api/projects/[id]/comments` | 发评论 |
| DELETE | `/api/projects/[id]/comments/[commentId]` | 删自己的；org admin 可删任意 |

组件：`src/components/project/CommentPanel.tsx`，挂在项目详情页（`src/app/(app)/projects/[id]/page.tsx`）侧栏。

### 4.3 多合伙人各自判断的展示与聚合

**现状扩展点（已读代码确认）**：

- `investment_judgments` 天然按 user_id 区分判断人，含结构化字段 `bull_case / bear_case / founder_assessment / key_hypothesis / confidence_level`（迁移 004）。
- 投委会总报告 `src/app/api/projects/[id]/reports/merge/route.ts`：现仅合并**报告**，输入由 `buildMergeUserContent` 拼装，`MERGE_SYSTEM` 定义七章节结构。**扩展点就在 `buildMergeUserContent` 的输入拼装处与 MERGE_SYSTEM 的章节定义处**。

设计：

1. **界面层**：组织项目详情页判断 tab 改为按人分组的并列视图（新组件 `src/components/project/JudgmentsByMember.tsx`）。数据接口 `GET /api/projects/[id]/judgments/aggregate`（partner/admin 可调，analyst 403——对应 1.2"看他人判断"规则），返回：

```typescript
interface MemberJudgments {
  userId: string;
  userName: string;
  role: string;
  judgments: Array<{
    stage: string;
    bull_case: string | null;
    bear_case: string | null;
    founder_assessment: string | null;
    key_hypothesis: string | null;
    confidence_level: number | null;
    created_at: string;
  }>;
}
```

2. **投委会总报告聚合**：`merge/route.ts` 改造——当项目是组织项目且调用者 partner/admin 时：
   - 源报告读取从 `AND user_id = $3` 放宽为 `AND (user_id = $3 OR org_id = $orgId)`（组织成员各自生成的报告均可入选）；
   - `buildMergeUserContent` 新增一段「各合伙人独立判断」：按成员分组拼入上述结构化判断（每人每阶段取最新一条，单人上限 2000 字符）；
   - `MERGE_SYSTEM` 七章节中「团队评估」之后插入一章 `## 合伙人观点对比`，prompt 追加规则："若多位合伙人判断存在分歧，必须并列呈现双方理由与各自 confidence_level，不得抹平分歧；总体『投资建议』需说明分歧对结论的影响。"
   - **结构化标识（v1.1 修订项 1）**：占位报告 INSERT 语句（`merge/route.ts:135-139`）写入 `kind='committee'`（替代现状的默认 'analysis' + 仅标题前缀【总报告】标识；CHECK 扩展与存量回填见迁移 023）。该 kind 是 1.2 矩阵"投委会总报告查看 partner+"与 2.3 `excludeMergedForAnalyst` 过滤的判定字段。个人版 merge 产物同样写 `kind='committee'`（统一数据语义；个人版无角色概念，本人始终可见，行为不变）。
   - 个人版（无 org）调用路径与产出内容完全不变。

### 4.4 组织内项目可见性与最简共享（迁移 023 第 2 段）

规则：partner/admin 全可见；analyst 仅 ① 自己 owner 的 + ② 被显式共享的。

```sql
-- 最简共享：把单个项目共享给组织内某个成员（只有"可见+可编辑"一档，不做权限细分）
CREATE TABLE IF NOT EXISTS project_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_project_shares_user
  ON project_shares(shared_with);

-- 投委会总报告结构化标识（v1.1 修订项 1）：
-- 现状 merge 产物仅靠标题前缀【总报告】区分（reports/merge/route.ts:135-139，
-- kind 走默认 'analysis'），标题可被 refine 改写，不能作为权限过滤依据。
-- 引入 kind='committee' 并回填存量行（回填方式与迁移 018 同模式）。
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN ('analysis', 'brief', 'term_sheet', 'committee'));

UPDATE reports SET kind = 'committee'
 WHERE kind = 'analysis' AND title LIKE '【总报告】%';
```

共享/取消共享：`POST` / `DELETE /api/projects/[id]/shares`（owner 或 partner/admin 操作）。`scopedProjectWhere`（2.3）已内置 project_shares 子查询，所有项目子资源可见性自动跟随。

---

## 第五部分：中鉴数据管道（占位设计）

中鉴 API 文档未到，本部分表结构与客户端接口按已讨论结构定稿，可直接建表；客户端实现留空。

### 5.1 四张表 DDL（迁移 `db/migrations/024_zjjr_pipeline.sql`）

```sql
-- ============================================================
-- 迁移 024：中鉴数据管道 — 公共数据层（物理隔离）
-- 红线：本组表与业务表无外键、无 JOIN 写路径；
--       主应用数据库账号对本组表仅 GRANT SELECT；
--       唯一写入者为独立同步服务（专用账号）。
-- 幂等：可重复执行。
-- ============================================================

-- 投资机构主数据
CREATE TABLE IF NOT EXISTS zjjr_institutions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 中鉴侧主键（增量同步对账键）
  source_id       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  -- 实体解析后的规范名（消歧产物，检索展示用）
  canonical_name  TEXT NOT NULL,
  -- 同一机构的别名/曾用名（消歧索引）
  aliases         JSONB NOT NULL DEFAULT '[]'::jsonb,
  institution_type TEXT,            -- VC / PE / FA / CVC / 政府引导基金 等，留 TEXT 待 API 字典确认
  fund_count      INTEGER,
  manage_scale    TEXT,             -- 管理规模区间（中鉴口径，原样存）
  focus_sectors   JSONB NOT NULL DEFAULT '[]'::jsonb,
  focus_stages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  region          TEXT,
  reg_status      TEXT,             -- 协会登记状态
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 中鉴原始记录全量留存
  source_updated_at TIMESTAMPTZ,    -- 中鉴侧更新时间（增量水位）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_inst_canonical ON zjjr_institutions(canonical_name);
CREATE INDEX IF NOT EXISTS idx_zjjr_inst_name_trgm
  ON zjjr_institutions USING GIN (name gin_trgm_ops);  -- 需 pg_trgm 扩展（点查模糊搜索）

-- 投资事件
CREATE TABLE IF NOT EXISTS zjjr_investments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       TEXT NOT NULL UNIQUE,
  institution_id  UUID NOT NULL REFERENCES zjjr_institutions(id) ON DELETE CASCADE,
  target_company  TEXT NOT NULL,
  sector          TEXT,
  stage           TEXT,             -- 轮次
  amount_text     TEXT,             -- 金额原文（"数千万人民币"类非结构化口径，原样存）
  invested_at     DATE,
  co_investors    JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_inv_institution ON zjjr_investments(institution_id);
CREATE INDEX IF NOT EXISTS idx_zjjr_inv_sector ON zjjr_investments(sector);
CREATE INDEX IF NOT EXISTS idx_zjjr_inv_date ON zjjr_investments(invested_at DESC);

-- 特征层：自然语言化后的可检索知识片段（AI 注入的唯一读取面）
CREATE TABLE IF NOT EXISTS zjjr_features (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 特征种类：机构画像 / 赛道动态 / 投资偏好 / 活跃度 等
  feature_kind    TEXT NOT NULL
                    CHECK (feature_kind IN (
                      'institution_profile', 'sector_trend',
                      'investment_preference', 'activity_summary'
                    )),
  institution_id  UUID REFERENCES zjjr_institutions(id) ON DELETE CASCADE,
  sector          TEXT,
  title           TEXT NOT NULL,
  -- 自然语言化正文（注入 prompt 的内容主体）
  content         TEXT NOT NULL,
  embedding       VECTOR(1536),     -- 与业务侧同一嵌入模型（百炼，src/lib/embedding.ts）
  -- 数据截止日（注入标注用）与有效期（过期降权，见 5.5）
  data_as_of      DATE NOT NULL,
  valid_until     DATE NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_features_kind ON zjjr_features(feature_kind);
CREATE INDEX IF NOT EXISTS idx_zjjr_features_inst ON zjjr_features(institution_id);
CREATE INDEX IF NOT EXISTS idx_zjjr_features_valid ON zjjr_features(valid_until);
-- 注意：embedding 的 ivfflat 索引【不在本迁移创建】。
-- ivfflat 的聚类中心在建索引时一次性确定，空表/小样本时建索引会导致
-- 聚类中心不具代表性、召回质量差。该索引由同步服务在首次全量导入
-- 完成后创建（SQL 见 5.2），大批量重灌数据后需 REINDEX。

-- 同步日志（增量水位 + 运维排障）
CREATE TABLE IF NOT EXISTS zjjr_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       TEXT NOT NULL
                    CHECK (sync_type IN ('institutions', 'investments', 'full', 'features_rebuild')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
  records_fetched INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  -- 本次同步推进到的增量水位（下次 updated_since 的取值）
  watermark       TIMESTAMPTZ,
  error_detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_zjjr_sync_log_type
  ON zjjr_sync_log(sync_type, started_at DESC);
```

注：迁移文件头部需 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`（点查模糊搜索依赖）。

### 5.2 同步服务架构

- **独立 Node 进程**：新目录 `services/zjjr-sync/`（与 `src/` 平级，不进 Next.js 构建），独立 `package.json`，共享数据库但使用**专用账号** `zjjr_sync`（对 `zjjr_*` 全权限，对业务表零权限——双向隔离）。
- **PM2 管理**：`services/zjjr-sync/ecosystem.config.js`，`cron_restart: "30 2 * * *"`（每日 02:30 增量轮询一次后进程退出，由 PM2 按 cron 重拉——比常驻进程内 setInterval 更可恢复）。
- **增量逻辑**：读 `zjjr_sync_log` 最近一次 success 的 `watermark` → 调 `fetchUpdates(updated_since=watermark)` → upsert（`ON CONFLICT (source_id) DO UPDATE`）→ 触发受影响实体的特征重建 → 写新水位。
- **ivfflat 索引创建（首次全量导入后执行，迁移 024 中刻意不建，原因见该迁移注释）**：同步服务在首次全量导入流水线（`sync_type='full'`）成功收尾时执行：

```sql
CREATE INDEX IF NOT EXISTS idx_zjjr_features_embedding ON zjjr_features
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

  此后日常增量写入由索引自动维护；若发生大批量重灌（如 `features_rebuild` 全量重建特征），重灌完成后执行 `REINDEX INDEX idx_zjjr_features_embedding;` 重算聚类中心。
- **与主应用解耦**：同步服务挂掉不影响主应用任何功能（zjjr 层检索返回旧数据或空）；主应用不感知同步服务存在。

### 5.3 `ZjjrClient` 接口抽象（`services/zjjr-sync/src/client.ts`，主应用不引用）

```typescript
export interface ZjjrPage<T> {
  items: T[];
  // 分页方式待 API 文档确认：cursor 或 page/pageSize，先按 cursor 抽象
  nextCursor: string | null;
  total: number | null;
}

export interface ZjjrInstitutionRaw { sourceId: string; raw: Record<string, unknown>; updatedAt: string; }
export interface ZjjrInvestmentRaw  { sourceId: string; institutionSourceId: string; raw: Record<string, unknown>; updatedAt: string; }

export interface ZjjrClient {
  fetchInstitutions(params: { cursor?: string; updatedSince?: string }): Promise<ZjjrPage<ZjjrInstitutionRaw>>;
  fetchInvestments(params: { cursor?: string; updatedSince?: string }): Promise<ZjjrPage<ZjjrInvestmentRaw>>;
  fetchUpdates(params: { updatedSince: string }): Promise<{
    institutions: ZjjrInstitutionRaw[];
    investments: ZjjrInvestmentRaw[];
  }>;
  healthCheck(): Promise<boolean>;
}

// 实现留空：待 API 文档到位后实现 HttpZjjrClient；
// 联调前可用 FixtureZjjrClient（读本地 JSON）打通全管道。
```

#### 待 API 文档确认清单（实施 HttpZjjrClient 前必须逐项确认）

| # | 待确认项 | 影响 |
|---|---|---|
| 1 | 字段结构（机构/投资事件的完整字段字典与枚举值） | `raw` → 结构化列的映射代码；institution_type 等是否加 CHECK |
| 2 | 分页方式（cursor / page+pageSize / scroll） | ZjjrPage 形状与翻页循环 |
| 3 | 限流规则（QPS、日配额、429 行为） | 同步节奏、退避重试策略 |
| 4 | 增量查询支持（是否有 updated_since；否则只能全量拉+本地 diff） | fetchUpdates 实现方式与同步耗时 |
| 5 | 认证方式（API Key header / 签名 / OAuth；Key 轮换机制） | 客户端配置与密钥管理（环境变量命名 `ZJJR_API_KEY` 等） |
| 6 | 机构唯一标识的稳定性（source_id 是否永不变更） | upsert 对账键可靠性 |
| 7 | 数据使用协议边界（可否落库缓存、展示字段范围、免责声明要求） | 第六部分点查字段范围与文案合规 |

### 5.4 数据处理流水线

```
拉取(raw) → 清洗 → 实体解析(消歧) → 特征提取 → 自然语言化 → 百炼向量化 → 双轨写入
```

各阶段（均在 `services/zjjr-sync/src/pipeline/` 下，每阶段一个模块）：

1. **清洗** `clean.ts`：去空白/全角规范化、枚举值映射（待字典）、日期解析失败入 `raw` 不丢弃。
2. **实体解析（机构名消歧）** `resolve.ts`：策略为三级匹配——① `source_id` 精确命中（同源更新）；② 规范化名精确匹配（去除"（有限合伙）/管理有限公司"等后缀的 canonical_name 比对）；③ pg_trgm 相似度 > 0.85 的候选**进人工复核队列**（写 `metadata.pending_merge`，不自动合并——机构名误合并的代价远高于重复）。别名累积进 `aliases`。
3. **特征提取** `extract.ts`：按 feature_kind 聚合统计（机构近 12 月出手次数、轮次分布、赛道集中度；赛道层近 90 天事件聚合）。
4. **自然语言化** `narrate.ts`：模板拼接为主（统计类特征不需要 LLM），输出 200–400 字片段；每段末尾内置数据截止日。
5. **向量化** `embed.ts`：调用与主应用相同的百炼 embedding（1536 维），复用 `src/lib/embedding.ts` 的请求参数约定（独立实现，不 import 主应用代码）。
6. **双轨写入** `write.ts`：结构化轨（institutions/investments upsert）+ 特征轨（features：受影响实体先删后插，保证特征与统计一致）。

### 5.5 特征有效期与过期降权

- 写入时设 `valid_until`：`institution_profile`/`investment_preference` = data_as_of + 90 天；`sector_trend`/`activity_summary` = data_as_of + 30 天（动态类时效短）。
- 检索时**降权不剔除**（3.3 的 freshness 系数 0.5）：过期特征仍可能是该机构唯一的画像信息，剔除会造成"查无此机构"的更差体验；注入标注会带数据截止日（第八部分），由文案明示时效。
- 同步服务每日重建受影响实体特征时自然续期；长期无更新的机构特征自然衰减。

---

## 第六部分：数据应用框架（可插拔注册制）

### 6.1 注册机制

新文件 `src/lib/dataApps.ts`：

```typescript
// src/lib/dataApps.ts —— 数据应用注册表
// 新增应用 = 此数组加一条 + 新建组件目录，框架零改动。

import type { ComponentType } from "react";

export interface DataAppConfig {
  id: string;                 // 路由段：/data-apps/[id]
  name: string;               // 导航显示名
  icon: string;               // emoji（与 SKILL_CATEGORIES 同风格，src/lib/skills.ts）
  description: string;
  requiredCapability: string; // 守门能力位
  component: () => Promise<{ default: ComponentType }>;  // 动态 import，按需加载
}

export const DATA_APPS: DataAppConfig[] = [
  {
    id: "market-insights",
    name: "市场洞察",
    icon: "📈",
    description: "基于中鉴基金研究院数据的定期市场动态汇总",
    requiredCapability: "zjjr_data",
    component: () => import("@/components/data-apps/MarketInsights"),
  },
  {
    id: "institution-lookup",
    name: "机构点查",
    icon: "🔎",
    description: "投资机构/投资人简要画像查询",
    requiredCapability: "zjjr_data",
    component: () => import("@/components/data-apps/InstitutionLookup"),
  },
];
```

- 统一入口：导航新增「数据应用」（`hasCapability(orgId,'data_apps')` 时渲染），页面 `src/app/(app)/data-apps/page.tsx`（应用卡片网格，逐个按 requiredCapability 过滤）与 `src/app/(app)/data-apps/[appId]/page.tsx`（按注册表解析 + `requireCapabilityAPI` 同款服务端守门）。
- middleware matcher 追加 `"/data-apps/:path*"`。

### 6.2 首批应用一：市场洞察（预生成，非实时）

生成机制：**定时任务调 AI 汇总 zjjr 数据 → 存表 → 页面读表展示**。

- 存储（迁移 `db/migrations/025_market_insights.sql`）：

```sql
-- 迁移 025：市场洞察预生成内容。幂等：可重复执行。
CREATE TABLE IF NOT EXISTS market_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 周期标识：如 '2026-W24'（周报）/ '2026-06'（月报）
  period        TEXT NOT NULL,
  period_kind   TEXT NOT NULL DEFAULT 'weekly'
                  CHECK (period_kind IN ('weekly', 'monthly')),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,            -- Markdown 正文
  data_as_of    DATE NOT NULL,            -- 数据截止日（页面免责声明引用）
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, period_kind)
);
```

- 生成器：同步服务内 `services/zjjr-sync/src/insights.ts`，每周一 03:30（PM2 第二个 cron 进程）聚合上周 `zjjr_investments` → 拼 prompt → 调平台系统 Key（DeepSeek，复用 `getSystemApiKey` 同一环境变量约定）→ 写 `market_insights`。生成失败保留上期内容，页面无感。
- 页面：`src/components/data-apps/MarketInsights.tsx` 纯读表渲染，列表 + 详情，零 AI 实时调用。
- 读取路由：`GET /api/data-apps/market-insights`（`requireCapabilityAPI('zjjr_data')`）。

### 6.3 首批应用二：机构/投资人点查

- 交互：搜索框（canonical_name/aliases 的 trgm 模糊匹配）→ 简要卡片。
- **字段范围限定**（卡片只出以下字段，与 5.3 待确认项 7 的协议边界对齐后可调）：机构名、类型、地区、登记状态、管理规模区间、关注赛道/阶段、近 12 月出手次数、最近 3 条投资事件（公司名+轮次+时间）。**不展示**：完整投资清单、LP 信息、具体金额。
- **禁止批量导出**：① 不提供任何导出按钮/接口；② 搜索接口每次最多返回 10 条候选、详情接口单次单机构；③ 同一用户点查频控：60 次/小时（内存计数即可，超出 429），在路由层实现。
- 路由：`GET /api/data-apps/institutions/search?q=`、`GET /api/data-apps/institutions/[id]`（均 `requireCapabilityAPI('zjjr_data')`）。
- **每页免责声明文案（固定，写死在组件底部）**：

> 数据来源：中鉴基金研究院。数据截止 {data_as_of}，仅供内部研究参考，不构成任何投资建议或对相关机构的资信评价。请勿对外传播或用于商业用途。如需完整数据服务，请联系中鉴基金研究院。

### 6.4 扩展位说明

后续 LP 匹配、赛道热力、同行对标等应用的接入方式：`DATA_APPS` 数组加一条注册配置 + `src/components/data-apps/` 下新建组件 +（如需新数据表）新增迁移。导航、路由解析、能力位守门、免责声明布局均由框架承担，**零框架改动**。约定：新应用如需服务端接口，统一挂 `/api/data-apps/<app-id>/...` 前缀并在路由内自行 `requireCapabilityAPI`。

---

## 第七部分：机构功能模块

### 7.1 机构档案管理

- **功能边界**：org 范围的项目档案统一视图——所有组织项目（含已 Pass/已退出）按阶段/赛道/owner 浏览与筛选；不新增档案数据结构。
- **数据来源**：projects（org_id 过滤）+ 既有子表。
- **复用**：现有归档页 `src/app/(app)/archive/page.tsx`、`src/app/(app)/archive/[projectId]/page.tsx` 的列表与详情组件整体复用，查询从 `user_id = $1` 换为 `scopedProjectWhere`（2.3 落地后近乎免费）。
- **新增**：页面 `src/app/(app)/org/archive/page.tsx`（org 视图入口 + owner 筛选下拉）；无新表；路由复用现有 `/api/projects`（scoped 后天然支持）。
- **工作量**：0.5–1 天（依赖第二部分完成）。

### 7.2 机构 Dashboard 统计分析

- **功能边界**：deal flow 漏斗（按 `projects.process_stage` 聚合）、赛道分布（`industry` 聚合）、成员活跃度（项目数/判断数/报告数 per member）、判断数量趋势（按周）。
- **参考实现模式**（已读代码确认）：`src/app/admin/dashboard/page.tsx` 的 Server Component + `Promise.all` 并发聚合 + Card 组件直查直渲，机构 Dashboard 完全照搬该模式，仅把全表 COUNT 换成 org 过滤聚合：

```sql
-- 漏斗
SELECT process_stage, COUNT(*) FROM projects WHERE org_id = $1 GROUP BY process_stage;
-- 赛道分布
SELECT COALESCE(industry,'未标注') AS industry, COUNT(*) FROM projects WHERE org_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
-- 成员活跃度
SELECT u.name, COUNT(DISTINCT p.id) AS projects, COUNT(DISTINCT j.id) AS judgments, COUNT(DISTINCT r.id) AS reports
  FROM org_members m JOIN users u ON u.id = m.user_id
  LEFT JOIN projects p ON p.org_id = m.org_id AND p.owner_id = u.id
  LEFT JOIN investment_judgments j ON j.org_id = m.org_id AND j.user_id = u.id
  LEFT JOIN reports r ON r.org_id = m.org_id AND r.user_id = u.id
 WHERE m.org_id = $1 GROUP BY u.id, u.name;
-- 判断趋势（近 12 周）
SELECT date_trunc('week', created_at) AS wk, COUNT(*) FROM investment_judgments
 WHERE org_id = $1 AND created_at > NOW() - INTERVAL '12 weeks' GROUP BY 1 ORDER BY 1;
```

- **新增**：页面 `src/app/(app)/org/dashboard/page.tsx`（`requireOrg("partner")` + `hasCapability('org_dashboard')`）；无新表、无新 API（Server Component 直查）。
- **工作量**：1–1.5 天。

### 7.3 LP 报告

- **功能边界**：选时间区间 + 项目范围 → 聚合投后数据 → 按模板流式生成 Markdown → 编辑 → docx 导出。不做 LP 门户、不做定期自动发送。
- **数据来源**：`post_investment_updates`（org 过滤 + period 区间）、projects（status='invested'）、investment_judgments（post_invest 阶段）、reports（聚合摘要）。
- **复用**：`reports` 表与全部报告基础设施——流式生成（`streamTextResponse`，`src/lib/report.ts:323`）、多轮修改（`/api/reports/[id]/refine`）、docx 导出（`src/lib/export.ts` + `/api/reports/[id]/export`）原样可用。
- **新增**：
  - 迁移 `db/migrations/026_lp_report_kind.sql`：

```sql
-- 迁移 026：reports 支持 LP 报告。幂等：可重复执行。
-- ① kind CHECK 纳入 'lp_report'（值列表含迁移 023 引入的 'committee'）；
-- ② project_id 放宽为可空：lp_report 挂组织维度，不挂单一项目。
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN ('analysis', 'brief', 'term_sheet', 'committee', 'lp_report'));

ALTER TABLE reports ALTER COLUMN project_id DROP NOT NULL;
```

  **最终方案：放宽 `project_id` 的 NOT NULL 约束**。LP 报告聚合的是组合层数据，挂在组织内任一"占位项目"上语义不可取，故 lp_report 行 `project_id IS NULL`、以 `org_id` 归属。**应用层不变量**：仅 `kind='lp_report'` 的行允许 `project_id IS NULL`；其余 kind 的全部创建路径继续强制传 project_id——该不变量在各生成接口层校验（现有报告创建路径全部经 `/api/projects/[id]/...`，project_id 来自路由参数天然非空；新的 `POST /api/org/lp-reports` 是唯一的 NULL 写入口），不依赖数据库约束。**影响面核对结论（保留 v1 结论）**：`/api/reports/[id]/*` 按 report id 查，不受影响；`/api/projects/[id]/reports` 按 project_id 查，NULL 行天然不出现，无影响。
  - 路由：`POST /api/org/lp-reports`（生成，流式）、`GET /api/org/lp-reports`（列表，按 `kind='lp_report' AND org_id=$1` 查）；页面 `src/app/(app)/org/lp-reports/page.tsx`。权限 partner+，能力位 `lp_reports`。
- **模板章节建议**（生成 system prompt 按此固定结构）：
  1. 基金概况与报告期说明
  2. 投资组合总览（在投项目清单：名称/赛道/轮次/投资时间/当前状态）
  3. 本期投资动态（新增投资、退出事件）
  4. 重点项目进展（按 post_investment_updates 的 milestone/financing 类逐项）
  5. 风险事项（update_type='risk' 聚合）
  6. 下期展望
  7. 附注与免责声明
- **工作量**：2–3 天。

### 7.4 协会报告辅助

- **定位**：辅助起草底稿，**非代报送**。页面与导出物均明示"本内容为内部底稿，正式报送以 AMBERS 系统填报为准"。
- **本期范围（架构占位）**：信息聚合输出三块——管理人基本情况（org 档案字段）、在管基金（**本期无基金实体表，以组织简介中人工维护的文本块代替**）、投资项目清单（org 内 status='invested' 项目的结构化清单）。输出为一份 Markdown 底稿，复用 docx 导出。
- **明确标注**：AMBERS 填报格式需后续专项调研，本期**只做**上述信息聚合 + 章节占位，不做字段级对照。
- **新增**：路由 `GET /api/org/assoc-report/draft`（聚合生成，非 AI，纯模板拼装）；页面 `src/app/(app)/org/assoc-report/page.tsx`。能力位 `assoc_report`，权限 admin。
- **工作量**：1 天（占位实现）。

---

## 第八部分：AI 注入层（三层检索注入 + 防穷举）

### 8.1 注入链扩展

**现状确切位置**（已读代码确认）：`injectProfile(userId, originalSystem)`（`src/lib/user-profile.ts:136-149`）把画像段前置到 system prompt，14 个路由调用；`buildMemoryContext`（`src/lib/memoryContext.ts:76`）在对话链路三段拼装。

新增两个注入函数，与 `injectProfile` 同构（失败静默降级、可空跳过），新文件 `src/lib/orgInject.ts`：

```typescript
// src/lib/orgInject.ts —— 机构层 / 中鉴层 prompt 注入

import type { AccessScope } from "@/lib/resourceAccess";

// 机构知识注入：检索机构沉淀层（visibility='org'），格式化为
// "## 机构知识沉淀" 段。无 org / 无 org_knowledge 能力位 / 无命中 → 返回原文。
export async function injectOrgKnowledge(
  scope: AccessScope,
  question: string,        // 检索 query（项目场景传项目名+行业+概述拼接）
  originalSystem: string
): Promise<string>;

// 中鉴市场上下文注入：检索 zjjr_features，格式化为
// "## 市场参考数据（中鉴基金研究院）" 段 + 防穷举硬规则（8.3）。
// 无 zjjr_data 能力位 / 无命中 → 返回原文（防穷举规则也不注入，个人版 prompt 零变化）。
export async function injectMarketContext(
  scope: AccessScope,
  question: string,
  originalSystem: string
): Promise<string>;
```

**插入位置**：各路由现有 `system: await injectProfile(uid, BASE)` 改为链式：

```typescript
const scope = await buildAccessScope(session.user.id);
let system = await injectProfile(session.user.id, BASE_SYSTEM);
system = await injectOrgKnowledge(scope, retrievalQuery, system);
system = await injectMarketContext(scope, retrievalQuery, system);
```

首批接入路由（其余 14 处按需跟进）：`/api/skills/run`、`/api/projects/[id]/reports`（生成）、`/api/projects/[id]/brief-analysis`、`/api/projects/[id]/reports/merge`、`/api/conversations/[id]/chat`（此处经 `buildMemoryContext` 内部改造，见 3.3）。

### 8.2 Token 预算分配

| 层 | 注入条数上限 | 单条截断 | 预算（约） |
|---|---|---|---|
| 个人层 | 5 条（现状 KB_TOPK=5 不变） | 200 字符（现状不变，`memoryContext.ts:106`） | ~1,000 字符 |
| 机构层 | 5 条 | 300 字符（机构沉淀通常更结构化，略放宽） | ~1,500 字符 |
| 中鉴层 | **5 条（硬上限，代码层常量）** | 400 字符（特征片段含统计） | ~2,000 字符 |
| 合计 | — | — | ~4,500 字符 ≈ 2,500–3,000 tokens |

总上限：注入段总和超过 6,000 字符时按 weighted 从低到高丢弃（先丢中鉴层过期条目）。该预算相对 8K 输出 + 各模型 ≥32K 上下文是安全的，且远小于现有 BP 注入（单文档 8,000 字符，`skills/run/route.ts:28`）。

### 8.3 防穷举系统约束

**代码层限制**：`injectMarketContext` 内 `const ZJJR_MAX_FRAGMENTS = 5;` 写死，不读配置——每次注入最多 5 条中鉴片段，从机制上保证 AI 拿不到可被穷举的数据量。

**system prompt 硬规则文案**（注入段尾部固定附带，写死在 `orgInject.ts`）：

> 【市场参考数据使用规则——必须遵守】
> 1. 上方「市场参考数据」仅用于辅助判断当前问题，只能引用与当前分析直接相关的片段。
> 2. 禁止罗列、汇总、导出机构名录或投资事件清单；当用户要求"列出所有/全部/前N家机构""导出××数据""××赛道都有哪些机构投了"等穷举或明细类请求时，不得基于参考数据作答，应回复下方导流话术。
> 3. 引用任何市场参考数据时，必须在句末标注来源（格式见下），不得将参考数据表述为你自己的知识。
> 4. 参考数据可能存在时效滞后，涉及关键决策时提示用户以中鉴基金研究院最新数据为准。

**导流响应模板**（写入同一 prompt 段，AI 识别穷举/明细类请求时输出）：

> 「这个问题涉及机构/投资事件的批量明细数据，超出了工作台内置参考数据的使用范围。如需完整的机构名录、投资事件明细或定制化数据研究，建议联系**中鉴基金研究院数据服务**获取正式授权的数据产品。我可以基于您正在分析的具体项目，继续提供针对性的判断参考。」

### 8.4 中鉴数据引用标注规范

所有注入片段在 `injectMarketContext` 内逐条格式化为：

```
[中鉴1] {title}（来源：中鉴基金研究院，数据截止{data_as_of}，仅供参考）
{content截断}
```

prompt 规则要求 AI 引用时沿用：`来源：中鉴基金研究院，数据截止2026年5月31日，仅供参考`。前端报告渲染处（现有 `src/lib/reportBadges.ts` 溯源徽章体系）后续可加 `[src:zjjr]` 徽章类型，本期先以文内标注为准。

---

## 第九部分：实施路线图

工期按 AI 辅助开发基准（设计已定稿、单人全栈 + AI 结对）。

### 依赖关系图

```
[P1 组织与权限层] ──┬──> [P2 资源org化+轻协作] ──┬──> [P4 机构功能模块]
   (020, orgAuth,   │      (021,023, resourceAccess)│   (7.1/7.2/7.3/7.4)
    capability)     │                               │
                    └──> [P3 机构知识库+AI注入(前两层)]
                           (022, knowledgeSearch,
                            injectOrgKnowledge)
                                                 
[P5 中鉴管道] ──> [P6 数据应用+中鉴注入]
 (024, 同步服务)      (025, dataApps, injectMarketContext)
  ▲ 被"中鉴 API 文档"阻塞（表结构与 Fixture 管道不阻塞）
```

### 分阶段计划

| 阶段 | 包含 | 前置依赖 | 工期 | 验收标准 |
|---|---|---|---|---|
| **P1 组织与权限层** | 迁移 020；`orgAuth.ts`（getOrgContext/requireOrg*/hasCapability+缓存）；JWT/middleware 改造；org 设置页 + 成员/邀请全部路由；admin 后台 org 管理 | 无 | 4–5 天 | ① 迁移生产执行后个人版全功能回归无差异；② 三角色矩阵抽样用例（admin 改角色即时生效、被移出者下个请求 403）；③ capabilities 调整 30s 内生效无需重登；④ 代码 grep 无版本名判断 |
| **P2 资源 org 化 + 轻协作** | 迁移 021、023；`resourceAccess.ts`；2.3 清单全部路由改造；项目转入组织；评论、共享、多人判断聚合（4.3 含 merge 扩展） | P1 | 5–7 天 | ① 个人版（无 org）所有改造路由 SQL 等价回归；② analyst 可见性规则用例（owner/共享/不可见）；③ 投委会总报告含「合伙人观点对比」章节且个人版产出内容不变；④ merge 产物写 `kind='committee'`、存量【总报告】行已回填，analyst 对组织项目的总报告查看/导出/refine 均 403 或不可见；⑤ 成员移出走 1.5 交接流程（有 owner 项目未带 transferOwnerTo 返回 409） |
| **P3 机构知识库 + AI 注入（前两层）** | 迁移 022；`knowledgeSearch.ts` 三层入口（zjjr 路暂空）；晋升/撤回接口与 UI；`injectOrgKnowledge` 接入首批路由 | P1（与 P2 可并行，仅共用 021 的 kb.org_id 列——021 提前到 P2 首日执行即可） | 3–4 天 | ① 晋升后 org 成员检索可命中、撤回后不可命中；② 个人版检索与注入行为零变化；③ 注入段带【机构沉淀】来源标注 |
| **P4 机构功能模块** | org 档案视图、org Dashboard、LP 报告（迁移 026）、协会报告占位 | P2（LP 报告另依赖 026） | 4–5 天 | ① Dashboard 四组统计与 SQL 直查一致；② LP 报告七章节生成→refine→docx 全链路通；③ 协会底稿含三块聚合与"非代报送"标注 |
| **P5 中鉴数据管道** | 迁移 024；同步服务骨架 + FixtureZjjrClient + 全流水线（清洗→消歧→特征→向量化→双轨写入）+ PM2 配置；HttpZjjrClient 实现 | 表结构/Fixture 不被阻塞；**HttpZjjrClient 被 API 文档阻塞** | 骨架 3–4 天；API 到位后联调 2–3 天 | ① Fixture 数据跑通全管道，zjjr_features 可检索；② 主应用账号对 zjjr 表仅 SELECT；③ 增量水位断点续跑；④ 首次全量导入后 ivfflat 索引已创建且向量检索走索引（EXPLAIN 验证，见 5.2） |
| **P6 数据应用 + 中鉴注入** | 迁移 025；dataApps 框架 + 市场洞察 + 机构点查；`injectMarketContext` + 防穷举 + 导流文案 | P1 + P5 骨架（Fixture 数据即可开发，上线需 P5 联调完成） | 3–4 天 | ① 能力位关闭时导航/路由/注入全部不可达；② 点查频控与无导出验证；③ 穷举类请求触发导流话术；④ 注入≤5 条且带标注 |

### 并行性与阻塞标注

- **完全不受中鉴 API 阻塞（先行）**：P1、P2、P3、P4 全部，以及 P5 骨架、P6 开发（用 Fixture 数据）。
- **被中鉴 API 文档阻塞**：仅 HttpZjjrClient 实现与真实数据联调（P5 后半段）、P6 的生产上线。
- **可并行**：P2 与 P3（P1 完成后两条线并进）；P5 骨架与 P2–P4 任意阶段并行（独立目录、独立进程，零代码交叉）。

### 建议总时间线（单人 + AI 结对，两线并行）

| 周 | 主线 | 副线 |
|---|---|---|
| 第 1 周 | P1 | — |
| 第 2 周 | P2 | P3 |
| 第 3 周 | P2 收尾 + P4 | P5 骨架 |
| 第 4 周 | P4 收尾 | P6 开发（Fixture） |
| 第 5 周起 | 机动/回归 | API 文档到位后 P5 联调 + P6 上线（+1 周） |

**总计：约 4 周交付全部不受阻塞模块；中鉴 API 文档到位后再 +1 周交付数据增强能力。**

---

## 附录 A：设计约束符合性自查

| 约束 | 落实点 |
|---|---|
| 个人版零影响 | org_id 全部可空（2.2）；scoped 函数个人路径逐字节等价（2.3）；visibility 默认 private（3.1）；注入函数无 org 时返回原文（8.1）；各阶段验收含个人版回归 |
| 复用优先 | SKILL 框架不动仅改归属（2.3）；报告基建/refine/docx 全复用（7.3）；admin 统计模式照搬（7.2）；归档组件复用（7.1）；投委会总报告做加法（4.3）；adminAuth 模式复制（1.4） |
| 数据隔离红线 | zjjr 独立表无外键（5.1）；主应用 SELECT-only 账号（3.2）；同步服务专用账号双向隔离（5.2）；AI 只读（8 全部） |
| 能力位纯洁性 | 1.3 硬性原则 + P1 验收 grep 检查 |
| Docker 私有化兼容 | 见附录 B |
| 生产迁移纪律 | 迁移 020–026 各自成文件、编号唯一单调；每阶段验收第一项均为"迁移先于代码部署" |

## 附录 B：私有化部署中的中鉴数据处理

两个方案对比：

| 维度 | 方案一：API 远程调用中鉴数据服务 | 方案二：私有化版本不含中鉴数据 |
|---|---|---|
| 实现成本 | 高：需为 zjjr 层检索做远程 RPC 抽象（zjjr_features 检索改为 HTTPS 调中鉴/中鉴智投托管端点），注入链路加超时降级 | 零：能力位 `zjjr_data:false` 即全链路自然关闭（导航、注入、点查全部不可达，已由框架保证） |
| 数据安全叙事 | 客户私有数据不出域（仅检索 query 文本出域——**仍需向客户披露**） | 完全不出域，叙事最干净 |
| 商业价值 | 私有化客户也能买数据增强 | 数据增强仅 SaaS 版可售 |
| 时效与运维 | 依赖网络可达性与托管服务 SLA | 无新增运维 |

**结论：首发采用方案二**——私有化镜像 = 机构协作版能力包（`zjjr_data:false, data_apps:false`），架构上零额外工作（这正是能力位机制的红利）。方案一作为后续商业化选项：本架构已为其预留了唯一需要的抽象点（zjjr 层检索集中在 `knowledgeSearch.ts` 的单一函数内，替换为远程实现即可），无需现在投入。

## 附录 C：新增/改造文件总清单

| 类型 | 路径 |
|---|---|
| 迁移 | `db/migrations/020_orgs_and_members.sql` ~ `026_lp_report_kind.sql`（七个文件，见各部分） |
| 新增 lib | `src/lib/orgAuth.ts`、`src/lib/resourceAccess.ts`、`src/lib/knowledgeSearch.ts`、`src/lib/orgInject.ts`、`src/lib/dataApps.ts` |
| 改造 lib | `src/lib/auth.ts`（jwt/session callback）、`src/middleware.ts`（matcher+org 分支）、`src/lib/memoryContext.ts`（换三层检索） |
| 新增页面 | `src/app/(app)/org/{settings,archive,dashboard,lp-reports,assoc-report}/page.tsx`、`src/app/(app)/data-apps/page.tsx`、`src/app/(app)/data-apps/[appId]/page.tsx`、`src/app/admin/orgs/page.tsx` |
| 新增组件 | `src/components/project/CommentPanel.tsx`、`src/components/project/JudgmentsByMember.tsx`、`src/components/data-apps/MarketInsights.tsx`、`src/components/data-apps/InstitutionLookup.tsx` |
| 新增 API | 第一部分 13 条 org/admin 路由；4.2/4.4 评论与共享 5 条；4.3 聚合 1 条；2.4 转入 1 条；3.4 晋升/撤回 2 条；6.2/6.3 数据应用 3 条；7.3/7.4 机构报告 3 条 |
| 改造 API | 第二部分 2.3 清单（24 个路由文件） |
| 改造页面（2.3 清单外补充） | `src/app/(app)/projects/[id]/page.tsx` —— P2 实施时主动补：原页面以 `WHERE id=$1 AND user_id=$2` 收口，组织成员无法打开他人的组织项目，端到端协作不可用。改为 `buildAccessScope` + `assertProjectAccess(read)` 门禁后按 id 取数。无组织用户访问决策与 `notFound` 行为与改造前等价（详见 `docs/deploy/P2_P3_DEPLOYMENT.md` 回归清单）。原因：端到端协作可用性要求。同批附带 `knowledge/page.tsx`（层切换+晋升入口）、`ProjectDetail.tsx`（协作区）、`ShareControl.tsx` 等 UI 改造 |
| 独立服务 | `services/zjjr-sync/`（client / pipeline / insights / ecosystem.config.js） |

### 附录 C 补充：P4 机构模块 + 导航整合（2026-06-13）+ P5 数据管道骨架（2026-06-15）

P4 与导航整合阶段实际新增/改造的关键文件（在前表基础上补充，含落地后命名调整）：

| 类型 | 路径 | 说明 |
|---|---|---|
| 导航整合·组织工作台 | `src/app/(app)/org/workspace/page.tsx` + `src/components/org/OrgWorkspaceClient.tsx` | 三 tab（概览 / 成员与设置 / 对外报告）合并原 dashboard/settings/报告入口，org 成员一级入口 |
| 导航整合·档案双视图 | `src/app/(app)/archive/page.tsx`（`?view=personal\|org`）、`src/app/(app)/archive/ArchiveFilters.tsx` | 个人归档 + 机构档案并入同一页；`src/app/(app)/org/archive/page.tsx` 改为 `redirect("/archive?view=org")`；`src/app/(app)/org/archive/OrgArchiveFilters.tsx` 提供 owner 下拉 |
| P4·机构 Dashboard | `src/app/(app)/org/dashboard/page.tsx` + `src/components/org/OrgDashboardView.tsx` | 漏斗/行业/成员活跃度/12 周趋势，partner+ 且 `org_dashboard` |
| P4·LP 报告 | `src/app/(app)/org/lp-reports/page.tsx` + `src/components/org/LpReportClient.tsx` | 依赖迁移 026（`reports.kind='lp_report'`，`project_id` 可空） |
| P4·协会报告底稿 | `src/app/(app)/org/assoc-report/page.tsx` + `src/components/org/AssocReportClient.tsx` | 信息聚合底稿，admin + `assoc_report` |
| P4·能力位状态 | `src/components/org/OrgCapabilityStatus.tsx` | 全员可见本组织开通的能力 |
| P5·迁移 | `db/migrations/028_zjjr_pipeline.sql` | 四张 zjjr 表 + pg_trgm；ivfflat 索引首次全量后由同步服务建（不在迁移内）；编号顺延 026/027 后取 028 |
| P5·独立服务（落地结构） | `services/zjjr-sync/`：`src/client.ts`（ZjjrClient 接口 + FixtureZjjrClient + HttpZjjrClient stub）、`src/pipeline/{clean,resolve,extract,narrate,embed,write}.ts`、`src/sync-core.ts`、`src/{full-sync,incremental-sync,insights}.ts`、`fixtures/sample.json`、`scripts/smoke-test.ts`、`ecosystem.config.js`、`README.md` | 与 `src/` 平级，不进 Next.js 构建（根 tsconfig `exclude: ["services"]`）；HttpZjjrClient 待 API 文档（5.3 七项）实现 |
| P5·三层检索接通 | `src/lib/knowledgeSearch.ts`（`searchZjjr`） | `zjjr_data` 能力位 + 有向量时对 `zjjr_features` 检索；过期 freshness 0.5 降权不剔除；无数据静默空数组 |
| 发布工程 | `docker/init.sql` | 追加 020–027（含两个 021）+ `reports.kind` 前置补建；028 不并入（物理隔离，DBA 手动） |
