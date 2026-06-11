# 2026-06-11 · 机构版启动日 · 战略确认 → 架构 v1.1 → P1 生产上线

> 起因：合作各方确认共同设立**中鉴智投公司**，以 Aivestor 机构版为主要产品。
> 当日一气完成：机构版总架构设计（v1 → 评审 → v1.1）→ P1 组织与权限层
> 实施 → 迁移 020 生产执行 → 部署上线 → 首个组织创建。
> P1 代码实施细节见 `devlog/2026-06-11-p1-org-permission.md`，本篇记录
> 当日完整脉络与生产部署的实际执行结果。

---

## 一、当日时间线

| 阶段 | 产出 | commit |
|------|------|--------|
| 合作背景确认 | 各方同意共同设立中鉴智投公司，Aivestor 机构版为主要产品；机构版开发自此成为主线 | — |
| 架构设计 v1 | `docs/architecture/INSTITUTIONAL_ARCHITECTURE.md` 九部分总蓝图（组织与权限层/能力位、存量表 org 化、知识库三层、轻协作、中鉴管道占位、数据应用框架、机构功能模块、AI 注入+防穷举、路线图 P1–P6） | `f3fdfc2` |
| 评审修订 v1.1 | 4 处缺陷修复 + 2 处标注（见下） | `bfd2d1b` |
| P1 实施 | 迁移 020 + orgAuth + JWT/middleware + 组织 API 10 条 + 组织设置页 + admin 后台 org 管理（细节不在此重复，见 P1 devlog） | `c8ec61b` |
| 生产部署 | 迁移手动执行 + 构建 + PM2 重启 + 首个组织创建（§二） | — |

### v1.1 评审修订内容（4 修复 + 2 标注）

1. **投委会总报告查看权限绕穿**：v1 矩阵规定 analyst「看他人判断 ❌」，但总报告
   含「合伙人观点对比」章节且查看权限跟随项目可见性，analyst 经自己 owner /
   被共享项目的总报告即可绕穿。修复：查看权限提升为 partner+，引入
   `reports.kind='committee'` 结构化标识（现状 merge 产物仅有【总报告】标题
   前缀，可被 refine 改写，不能作权限依据）。
2. **org_invitations 唯一约束缺陷**：三列 `UNIQUE (org_id, identifier, status)`
   在同一身份第二次被撤销/过期时违反唯一约束。修复：改为
   `WHERE status='pending'` 部分唯一索引。
3. **LP 报告 project_id 约束自相矛盾**：v1 先写"不放宽该约束"又写
   `DROP NOT NULL`。修复：改写为明确放宽 + 应用层不变量（仅 lp_report 行
   允许 NULL，生成接口层校验）。
4. **成员移出资产交接缺失**：新增 1.5 小节——owner 项目须 `transferOwnerTo`
   交接（未带则 409 + 待交接清单），共享关系随事务清理，历史痕迹保留。
5. （标注）jwt callback 与 getOrgContext 重复查询的性能标记，不改设计，
   优化方向 `orgCheckedAt`，P1 实施留 TODO。
6. （标注）`zjjr_features` ivfflat 索引从迁移 024 移除，改为首次全量导入后
   由同步服务创建（空表建索引聚类中心失真）。

---

## 二、生产部署记录（实际执行结果）

部署顺序按 P1 devlog 的纪律执行：先迁移、后部署。

### 迁移 020

- 生产库手动执行 `db/migrations/020_orgs_and_members.sql` 成功：
  9 条 CREATE（3 表 + 2 触发器 + 4 索引），无 ERROR。
- **权限补授**：执行
  `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aivestor;`
  ——postgres 超级用户跑迁移后，新表默认不属于应用账号，沿用 V3.0 部署时
  踩过的同一坑（应用账号查新表报 permission denied）。
- 验证通过：

```sql
SELECT to_regclass('public.orgs'), to_regclass('public.org_members'),
       to_regclass('public.org_invitations');
-- 三者均非 NULL

SELECT indexname FROM pg_indexes
 WHERE indexname IN ('idx_org_members_single_org','idx_org_invitations_pending');
-- 两条关键索引均在位
```

### 应用部署

- `npm run build`：63 路由全部通过。
- PM2 restart：`Ready in 792ms`，进程 online。
- **构建/运行日志说明**（避免后续误判）：
  - `skills/catalog Dynamic server usage` 为 Next.js 静态化回退提示
    （V2.9 后即有），非错误；
  - `error.log` 中的 digest TypeError 为历史残留日志，非本次部署产生。

### 部署后验证

- **个人版回归**：无组织用户界面与行为无任何变化，Sidebar 无「组织设置」
  入口 ✅（P1 设计约束"个人版零影响"达成）。
- **首个组织**：经 `/admin/orgs` 创建组织「aivestor」，首个 org admin 指定
  成功。
- **能力位配置**：admin 详情页应用数据增强版预设（boolean 位全 true），
  `max_members` 手工调整为 **20**（预设默认 30）。

---

## 三、遗留事项

| 项 | 说明 | 何时做 |
|----|------|-------|
| 角色矩阵双账号手测 | 邀请→接受→改角色→移出 全链路双账号实测（P1 devlog 手测步骤 1–6），单组织单成员现状下暂不可测全 | P2 部署后与协作功能一起实测 |
| 中鉴 API 文档 | 未到位；7 项待确认清单见架构文档 5.3（字段结构/分页/限流/增量/认证/source_id 稳定性/数据协议边界） | 阻塞 P5 后半段（HttpZjjrClient）与 P6 上线，其余阶段不受阻 |
| 下一步开发 | P2+P3 合并任务包：资源 org 化（迁移 021）+ 24 路由 scoped 改造 + 轻协作（评论/共享/多人判断聚合，迁移 023）+ 机构知识库三层（迁移 022）+ 注入前两层（injectOrgKnowledge） | 下个任务包 |

---

## 四、交叉引用

- 架构文档 v1.1：`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md`
- P1 实施 devlog：`devlog/2026-06-11-p1-org-permission.md`（部署顺序、手测步骤、回归清单）
- commits：
  - `f3fdfc2` — docs: institutional architecture design v1
  - `bfd2d1b` — docs: institutional architecture v1.1 - review fixes
  - `c8ec61b` — feat: P1 org & permission layer (arch v1.1)
