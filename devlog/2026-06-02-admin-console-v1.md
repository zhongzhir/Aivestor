# 2026-06-02 · 管理后台 V1（/admin）

> 起因：内测启动后需要看用户增长、调整免费额度。Aivestor 此前没有任何
> 管理面，要看数都得连 psql。这次落一个最小可用的 admin 控制台，
> 覆盖"看数 + 调额度"两个最高频的运营动作。

涉及 commit：`9665317`（仓库提交）

---

## 一、权限模型

### 决策：复用 `users.plan`，不新增 `role` 列

`users` 表既有 `plan TEXT CHECK (plan IN ('personal', 'pro', 'team'))`。
本可以新加 `role` 列做正交切分，但：
- V1 只有一个 admin（创始人），plan/role 解耦的收益小于改 schema 的成本
- 后续如果需要更细颗粒（如 `support` 客服、`auditor` 审计员），随时可以
  补一个 `role` 列做平行维度，不会和现有 plan 冲突

迁移 `019_admin_plan.sql` 只做一件事：DROP + 重建 CHECK 把 `'admin'` 加入白名单。

### 设管理员

```sql
UPDATE users SET plan = 'admin' WHERE email = '<创始人邮箱>';
```

---

## 二、鉴权：双层防御

| 层 | 实现 | 何时跑 | 数据源 |
|----|------|-------|--------|
| Edge 快路径 | `middleware.ts` 读 JWT `token.plan` | 每个 `/admin/*` 请求进 Next.js 之前 | NextAuth JWT（登录时写） |
| Node 真值校验 | `requireAdmin()` / `requireAdminAPI()` | Server Component 渲染 / API 路由进入时 | 实时查 `users.plan` |

为什么要两层：
- 仅 middleware：JWT token.plan 是登录瞬间写死的，admin 被降级后 token 还
  有效，会绕过校验
- 仅服务端 DB 现取：每个静态资源都要查一次 DB，Edge 没法直连 PG，反代+回源
  开销大；middleware 在边缘先把绝大多数"明显不是 admin"的请求 302 掉
- 两层叠加：middleware 砍掉 99%，服务端最后一道闸保证 DB 是唯一权威

### Token 注入

`src/lib/auth.ts` 的 `jwt` callback 改造：

```ts
async jwt({ token, user, account }) {
  if (user) {
    // ...uid 注入逻辑...
    const rows = await query<{ plan: string }>(
      "SELECT plan FROM users WHERE id = $1",
      [user.id]
    );
    if (rows[0]) token.plan = rows[0].plan;
  }
  return token;
}
```

`session` callback 把 `token.plan` 透出到 `session.user.plan`，前端组件可读
（例如未来在侧栏给 admin 展示「管理后台」入口）。

### 已知约束：升级 admin 后必须重登

JWT 是登录瞬间生成的。运营手动 `UPDATE users SET plan='admin'` 之后，旧 token
里还是 `'personal'`。当事人必须**退出登录 + 重新登录**才能进 admin。
V1 接受这个约束，不引入 token 强制刷新机制（复杂度过高）。

---

## 三、文件结构与设计

```
src/
  middleware.ts                      # 加 /admin/:path* matcher + plan 校验
  lib/
    auth.ts                          # jwt/session 注入 plan
    adminAuth.ts                     # requireAdmin / requireAdminAPI
  app/
    admin/                           # 真实路径段，不用 (admin) 路由组
      layout.tsx                     # 左侧导航数组化 + 右侧 main
      page.tsx                       # → /admin/dashboard
      dashboard/page.tsx             # 用户/内容/额度三类聚合卡片
      users/page.tsx                 # 搜索 + 分页
      users/[id]/page.tsx            # 详情 + 项目 + 额度日志 + 调整按钮
      quota/page.tsx                 # 批量调额度
    api/admin/
      quota/route.ts                 # POST UPSERT free_quota_usage
  components/
    admin/
      QuotaAdjuster.tsx              # 单用户调上限（client）
      QuotaBatchPanel.tsx            # 勾选批量调（client）
db/
  migrations/
    019_admin_plan.sql               # 放宽 users.plan CHECK
```

### 为什么不用 `(admin)/` 路由组

最初写的是 `src/app/(admin)/dashboard/page.tsx`——`()` 是隐形的，结果 URL
是 `/dashboard`，跟 `(app)/dashboard/page.tsx` 撞，build 直接报
`You cannot have two parallel pages that resolve to the same path`。

改用真实路径段 `admin/`：
- URL 是 `/admin/*`，跟 `(app)/*` 完全错开
- `admin/layout.tsx` 是独立 layout，不继承 `(app)/layout.tsx` 的侧栏 + Footer，
  符合 admin 自己有左导航的设计

### 不用 Server Actions

按 V1 要求"用标准 API Routes"。理由：API 路由跟 middleware 鉴权对齐更直接，
权限点收敛在 `requireAdminAPI()` 一处；Server Actions 的鉴权也能做，但会
分散到多个 action 文件，V1 收益不明显。

---

## 四、指标定义

### 7 日活跃用户

Aivestor 没有 `users.last_login_at` 列。最稳妥的"活跃"代理：

```sql
SELECT COUNT(DISTINCT user_id) FROM free_quota_logs
 WHERE created_at > NOW() - INTERVAL '7 days'
```

free_quota_logs 在 `consumeQuota()` 调用时插入，意味着"过去 7 天用过 AI"。
比"过去 7 天登录过"更接近真实活跃度，且无需新 schema。

加 `last_login_at` 列 + 回填属于 V2 范围。

### 累计 tokens 消耗

`SUM(tokens_used) FROM free_quota_usage`——每个用户当前累积消耗，相当于
全平台代付 token 的总账。

---

## 五、调额度的 UPSERT 兜底

直觉做法是 `UPDATE free_quota_usage SET tokens_limit = $1 WHERE user_id = $2`。
但 V1 内测用户里有不少是注册后还没用过 AI 的，`free_quota_usage` 行根本不
存在（首次 `consumeQuota` 才 INSERT），单 UPDATE 影响 0 行。

实现用 UPSERT：

```sql
INSERT INTO free_quota_usage (user_id, tokens_used, tokens_limit)
  SELECT id, 0, $2 FROM users WHERE id = ANY($3::uuid[])
ON CONFLICT (user_id) DO UPDATE
  SET tokens_limit = EXCLUDED.tokens_limit,
      updated_at   = now()
RETURNING user_id
```

`RETURNING user_id` 的行数就是实际影响数，前端展示"已更新 N 个用户"。

---

## 六、UPSERT 限额上界

`MAX_LIMIT = 1_000_000_000`（10 亿 tokens）。运营手抖写个超大数会怎样？

- PG 是 `BIGINT`，存得下，但语义上等于"无限额度"
- consumeQuota 永远不会触发耗尽降级，相当于免费给该用户开了 unlimited

加这个上界纯属手误防护——10 亿 tokens 按当前 DeepSeek 单价能用很久，
任何正常需求都到不了这个数。要给某个用户开"无限"，建议改 plan 而不是
拉爆 tokens_limit。

---

## 七、ECS 部署步骤实录

```bash
# 1. 拉代码
cd /var/www/Aivestor
git pull --ff-only        # 1983fd8..9665317

# 2. 跑迁移
npm run db:migrate -- db/migrations/019_admin_plan.sql
# 输出：✓ 迁移已应用：db/migrations/019_admin_plan.sql

# 3. 设管理员
psql -h localhost -U aivestor -d aivestor_db \
  -c "UPDATE users SET plan = 'admin' WHERE email = '<email>';"

# 4. 重建 + 重启
npm run build
pm2 restart aivestor

# 5. 浏览器退出登录 + 重登 → 访问 /admin
```

验证通过：dashboard 数字正常显示。

---

## 八、V1 范围之外（V2 候选）

- `users.last_login_at` 列 + 登录时 UPDATE → 7 日活跃更准确
- 操作日志表 `admin_audit_log`：所有 admin 写操作（调额度、未来的冻结账号、
  改 plan）落日志，admin 自己也被审计
- SKILL 管理：编辑/下架官方 SKILL，无需手改 DB
- 公告发布：在 Landing/Dashboard 顶部挂条目
- 用户冻结：`users.status` 列（active/frozen），冻结后 login 拒绝
- token 强制刷新机制：admin 降级时让对方下次请求自动重登
