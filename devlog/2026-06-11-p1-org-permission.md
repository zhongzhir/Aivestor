# 2026-06-11 · P1 组织与权限层（机构版第一阶段）

> 设计依据：`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md` v1.1 第一部分（1.1–1.5）
> 提交：`feat: P1 org & permission layer (arch v1.1)`

## 交付内容

| 块 | 内容 |
|---|---|
| 迁移 | `db/migrations/020_orgs_and_members.sql`（orgs / org_members / org_invitations，一人一 org 唯一索引，pending 部分唯一索引；**未在任何环境执行**） |
| 鉴权库 | `src/lib/orgAuth.ts`：getOrgContext（每请求 DB 现取）/ getOrgCapabilities（内存缓存 30s TTL）/ hasCapability / getCapabilityNumber / requireOrg / requireOrgAPI / requireCapabilityAPI / invalidateOrgCapabilities |
| JWT/session | `src/lib/auth.ts` jwt callback 每次重读 org_members 注入 token.orgId/orgRole（含 orgCheckedAt 性能 TODO 注释）；session 透出 orgId/orgRole；`src/types/next-auth.d.ts` 类型扩展 |
| middleware | `src/middleware.ts`：matcher 加 `/org/:path*`，org 分支快路径（无 token.orgId → 302 /dashboard） |
| 组织 API | `/api/org`（GET/PATCH）、`/api/org/members`（GET）、`/api/org/members/[userId]`（PATCH/DELETE 含 1.5 资产交接）、`/api/org/invitations`（POST/GET）、`/api/org/invitations/[id]`（DELETE 撤销）、`/api/org/invitations/mine`（GET）、`/api/org/invitations/[id]/accept`（POST） |
| 组织设置页 | `src/app/(app)/org/settings/page.tsx` + `src/components/org/OrgSettingsClient.tsx`（成员/邀请/组织信息/能力位只读）+ `PendingInvites.tsx` 邀请卡片（挂个人设置页顶部）+ Sidebar 条件入口 |
| admin 后台 | `/admin/orgs` 列表 + 创建表单、`/admin/orgs/[id]` 详情（capabilities 逐项开关 + 两个预设包按钮 + 停用/启用 + 成员只读）；API `/api/admin/orgs`（POST/GET）、`/api/admin/orgs/[id]`（PATCH，**修改后主动清 orgAuth 缓存**）；admin 左导航加「组织管理」 |

## 部署顺序（必须严格按序）

1. **生产库手动执行** `db/migrations/020_orgs_and_members.sql`
2. 验证三表存在：
   ```sql
   SELECT to_regclass('public.orgs'), to_regclass('public.org_members'),
          to_regclass('public.org_invitations');
   -- 三者均非 NULL；另验证两个唯一索引：
   SELECT indexname FROM pg_indexes WHERE tablename IN ('org_members','org_invitations')
    AND indexname IN ('idx_org_members_single_org','idx_org_invitations_pending');
   ```
3. 部署代码（git pull + npm run build）
4. PM2 restart

容错说明：即使顺序颠倒（代码先上、020 未执行），jwt callback / getOrgContext / invitations/mine / admin orgs 页均做了 try/catch 降级，个人版不受影响；但 org 功能在迁移执行前不可用，admin 组织管理页会显示迁移提示。

## 首个 org 创建路径

平台 admin（users.plan='admin'）登录 → `/admin/orgs` → 「创建组织」表单填组织名 + 首个管理员的邮箱/手机号（须已注册）→ 创建后该用户即为 org admin，再由其在 `/org/settings` 邀请其他成员。

## 角色矩阵抽样手测步骤

1. **改角色即时生效**：org admin 在 /org/settings 把成员 B 从 partner 改为 analyst → B 不刷新页面直接调 `GET /api/org/invitations`（admin-only）→ 应 403（每请求 DB 现取）。
2. **移出即时拒绝**：org admin 移除成员 C → C 的下一个请求：访问 `/org/settings` → middleware 可能凭旧 token 放行一次，但页面层 `requireOrg` DB 现取 → 302 /dashboard；调 `/api/org` → 403。无数据返回。
3. **analyst 调 admin 接口**：analyst 调 `POST /api/org/invitations` → 403。
4. **capabilities 生效**：平台 admin 在 /admin/orgs/[id] 修改 max_members → 保存（PATCH 路由主动清缓存）→ org 侧立即按新值校验邀请；若多实例部署，其余实例最迟 30s（TTL）生效。无需任何用户重登。
5. **邀请全流程**：发邀请（超 max_members 被拒）→ 被邀请人在 /settings 看到卡片 → 接受成为成员；撤销后接受返回 404；同一身份撤销后可再次邀请（部分唯一索引只约束 pending）。
6. **1.5 交接（P2 后生效）**：当前 projects 无 org_id/owner_id 列，DELETE 自动跳过交接检查（information_schema 探测）；迁移 021 执行后，移除名下有组织项目的成员将返回 409 + 项目清单，前端弹交接选择框。

## 个人版回归抽查清单（部署后逐条过）

| # | 路径 | 预期 |
|---|---|---|
| 1 | 邮箱/手机号登录 → /dashboard | 正常，无 org 用户 Sidebar 不出现「组织设置」 |
| 2 | /chat 发起对话 | 流式回复正常 |
| 3 | /projects 上传 BP → 生成分析报告 | 正常 |
| 4 | /knowledge 搜索 | 正常 |
| 5 | /skills 运行任一 SKILL | 正常 |
| 6 | 报告导出 Word | 正常 |
| 7 | 无 org 用户直接访问 /org/settings | 302 /dashboard |

## 验收对照

- [x] 迁移 020 独立文件、幂等、pending 部分唯一索引；未执行
- [x] 个人版零影响（org 信息注入全部 try/catch 降级；`npm run build` 63 路由全部通过）
- [x] 角色矩阵抽样用例（上方手测步骤 1–3）
- [x] capabilities 30s TTL + admin 修改路由主动清缓存（步骤 4）
- [x] grep 无版本名判断（命中均为展示文案/注释，无条件逻辑）
- [x] 邀请全流程（步骤 5）
- [x] 1.5 交接逻辑已实现 + 021 未执行时容错跳过（代码注释标明）
- [x] auth.ts 留 TODO(perf) orgCheckedAt 注释
