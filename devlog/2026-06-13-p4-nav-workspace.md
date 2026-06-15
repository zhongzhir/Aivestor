# 2026-06-13 · P4 机构功能模块 + 导航整合 + 权限收紧

> 设计依据：`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md` v1.1 第七部分（机构档案/Dashboard/LP 报告/协会报告）
> 提交：`62a6a7c`（P4 模块）、`2b136ef`（导航整合）、`34425ed` / `caeae52`（权限收紧）

## 一、P4 机构功能模块（62a6a7c）

| 模块 | 页面 / 组件 | 能力位守门 | 角色守门 |
|---|---|---|---|
| 机构档案（统一视图） | `org/archive/page.tsx`（后并入项目档案双视图）、`OrgArchiveFilters.tsx` | `org_dashboard` | partner+ |
| 机构 Dashboard | `org/dashboard/page.tsx`、`components/org/OrgDashboardView.tsx` | `org_dashboard` | partner+（含成员活跃度，仅管理层） |
| LP 报告 | `org/lp-reports/page.tsx`、`components/org/LpReportClient.tsx` | `lp_reports` | partner+ |
| 协会报告底稿 | `org/assoc-report/page.tsx`、`components/org/AssocReportClient.tsx` | `assoc_report` | admin |
| 能力位状态展示 | `components/org/OrgCapabilityStatus.tsx` | — | 全员可见（看本组织开通了什么） |

- Dashboard 四组统计（漏斗 / 行业分布 / 成员活跃度 / 12 周判断趋势）服务端 `Promise.all` 聚合，复用 admin dashboard 模式。
- LP 报告依赖迁移 026（`reports.kind='lp_report'`，`project_id` 放宽可空，挂 org_id 维度）。
- 协会报告底稿定位为「信息聚合辅助起草，非代报送」，文案明示免责。

## 二、导航整合（2b136ef）

机构功能此前散落多个一级入口，整合为两处，降低导航复杂度：

1. **项目档案双视图**：`/archive?view=personal|org` 一个页面承载个人归档与机构档案。
   旧 `/org/archive` 路由保留为重定向（`redirect("/archive?view=org")`），避免书签 404。
   机构视图额外提供 owner 下拉（管理层按成员浏览，`OrgArchiveFilters.tsx`）。
2. **组织工作台三 tab**：`/org/workspace`（`OrgWorkspaceClient.tsx`）合并原 dashboard / settings /
   报告入口为三个 tab：
   - **概览**：统计看板（partner+ 且 `org_dashboard`）+ 能力位状态（全员）。
   - **成员与设置**：内嵌 `OrgSettingsClient`（admin 管成员/邀请；非 admin 只读组织信息）。
   - **对外报告**：LP 报告（partner+）/ 协会报告底稿（admin）入口列表，按能力位决定可点/禁用态。

## 三、三轮权限收紧

导航整合把多个入口聚到工作台后，逐轮堵漏，确保「能进入口」与「能看内容」严格分离：

1. **第一轮（2b136ef 内）**：工作台页面级 `requireOrg()` 守门——无组织 → 302 /dashboard。
   概览统计服务端按 `org_dashboard` 能力位 + partner/admin 才聚合并下发 `dashboard` 数据，
   不向 analyst 下发统计数据（数据层不可见，而非仅 UI 隐藏）。
2. **第二轮（34425ed）**：工作台各 tab 内容按角色裁剪。analyst 可进入工作台/概览（看能力位状态），
   但概览统计看板显示「仅管理层可见」；客户端再判一次 `isManager`，与服务端不下发数据形成纵深防御。
3. **第三轮（caeae52）**：「对外报告」tab 列表条目按角色裁剪——LP 报告对 partner+ 可见，
   协会报告底稿仅 admin 可见；条目内再按能力位决定可点（`Link`）或禁用态（灰显 + 未开通提示）。
   避免 analyst 经工作台对外报告列表绕看 partner/admin 才有的报告入口。

**结论**：能力位（组织级开关）与角色（成员安全边界）双重守门；安全边界以服务端每请求
`requireOrg` / `getOrgContext` DB 现取为准，客户端裁剪仅作 UI 纵深，不作授权依据。

## 四、已知问题：本地部署 init.sql 落后（本次 P5 部分修复）

- `docker/init.sql` 此前停留在合并 001–018（第一序列）的状态（V3.1.1，2026-06-01），机构版
  020–027 全部未合并，导致全新本地部署因缺表/缺列机构版功能 500。
- **2026-06-15（P5 任务）已追加** 020–027（含两个 021：`document_image_analysis` + `org_resource_columns`），
  并补建其硬依赖 `reports.kind`（第二序列 `018_reports_kind`，init.sql 同样遗漏，否则 023/026 报错）。
- **仍遗留**：第二序列 `016_add_workflow_skills` / `017_add_screening_criteria` /
  `019_add_legal_skills` / `019_admin_plan` 未并入 init.sql（非机构版、非 500 阻断项：
  016/019_legal 为 skill_catalog 数据补充，017/019_admin 为 user_profiles / users 列与约束）。
  全新本地部署如需与生产完全对齐，另需手动执行这四个迁移文件。
- 迁移 028（中鉴数据管道）刻意**不并入** init.sql：物理隔离表，需专用账号 + GRANT，由 DBA 手动执行。
