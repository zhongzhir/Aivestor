# P2 + P3 部署与验收说明（资源 org 化 + 轻协作 + 机构知识库 + AI 注入前两层）

> 设计依据：`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md` v1.1
> 前置：P1 已上线（迁移 020 已执行，org「aivestor」能力位全开）
> 适用提交：`feat: P2 resource org-ization & light collaboration` + `feat: P3 org knowledge layer & injection`

---

## 一、迁移执行顺序（务必先迁移、后部署代码）

历史事故教训：metadata 列未迁移先上代码曾导致线上 500。**所有依赖新列/新表的代码必须在迁移于生产库手动执行完成后才能部署。**

在生产库按以下顺序手动执行（三个迁移彼此独立、均幂等、可重复执行）：

```
1. db/migrations/021_org_resource_columns.sql     # 九张表加 org_id，projects 另加 owner_id + 部分索引
2. db/migrations/022_org_knowledge_visibility.sql # knowledge_base_entries 加 visibility/promoted_by/promoted_at
3. db/migrations/023_collaboration.sql            # project_comments / project_shares + reports.kind='committee'
```

> 021 与 022/023 之间无强依赖顺序约束，但建议按编号顺序执行。022 依赖 021 的 `knowledge_base_entries.org_id`；023 依赖 021 的 `projects.org_id/owner_id` 与 018 的 `reports.kind`。

### 023 的 committee 回填人工核对（执行后立即做）

023 会把存量【总报告】标题前缀的报告回填为 `kind='committee'`。回填后执行：

```sql
SELECT COUNT(*) FROM reports WHERE kind = 'committee';
```

核对该计数与档案页橙色「总报告」角标数量一致。若不一致，排查是否有【总报告】前缀被 refine 改写过的历史行（需人工补 `UPDATE`）。

### GRANT 补授权提醒

- 本批次**不涉及 zjjr_* 表**（P5/P6 范围），无新增 GRANT 需求。
- 三个迁移创建的 `project_comments` / `project_shares` 表归主应用账号所有，常规 schema 下无需额外 GRANT。若生产使用受限应用账号（非表 owner），需对这两张新表补 `GRANT SELECT, INSERT, UPDATE, DELETE`，对相关序列补 `GRANT USAGE`。
- 部署前用受限账号实跑一次 `SELECT 1 FROM project_comments LIMIT 1; SELECT 1 FROM project_shares LIMIT 1;` 确认可读。

### 部署顺序总结

```
021 → 022 → 023 → committee 回填核对 → （如受限账号）补 GRANT → 部署代码
```

---

## 二、个人版零影响回归清单（最高优先）

无组织用户（`org_members` 无记录）在以下全部改造路由上，行为必须与改造前一致。等价性由 `resourceAccess.ts` 的退化路径保证：`scope.org === null` 时 `scopedProjectWhere` / `scopedProjectChildWhere` 返回 `user_id = $n`，params 仅 `[userId]`——与现状逐字节等价。

逐项以**无组织账号**验证（应与改造前完全一致）：

- [ ] `GET /api/projects` 列表只见本人项目；创建项目 `org_id/owner_id` 均为 NULL
- [ ] 项目详情页可正常打开（仅本人项目）
- [ ] documents：GET 列表 / POST 上传解析正常；新文档 `org_id` 为 NULL
- [ ] reports：生成 / brief-analysis / term-sheet / financials 正常；新报告 `org_id` 为 NULL
- [ ] reports/merge：产出与改造前一致（现写 `kind='committee'`，本人始终可见，无行为差异）
- [ ] judgments：GET 仅本人；POST 正常，新判断 `org_id` 为 NULL
- [ ] meetings / meetings summarize / updates / outcome / stage / decision / pending-questions：正常
- [ ] reports/[id] refine / export / export-ppt / digest：正常（本人报告可读）
- [ ] skills/run：catalog 与自建 SKILL 运行正常；自建仅命中本人
- [ ] skills/custom GET/POST、custom/[id] PUT/DELETE：仅本人 SKILL
- [ ] knowledge 列表（默认层）/ search / upload：与改造前一致（默认 `WHERE user_id=$1`）
- [ ] 对话链路 `buildMemoryContext`：注入内容与改造前一致（三层检索个人路自动退化为单层）
- [ ] AI 注入：无组织用户生成报告时 prompt **不含**「机构知识沉淀」段（`injectOrgKnowledge` 返回原文）
- [ ] `conversations/*`、`export/*` 未改动
- [ ] `npm run build` 全路由通过

---

## 三、双账号协作手测脚本（含 P1 遗留角色矩阵 6 条）

准备：org「aivestor」内三个账号——**A=admin、P=partner、N=analyst**。能力位全开（collaboration / org_knowledge 等为 true）。

### A. P1 遗留角色矩阵复测（6 条）

1. [ ] A 改 N 的角色为 partner → N 下一个请求即生效（无需重登），改回 analyst 同理
2. [ ] A 移除某成员 → 被移除者下一个请求 403（token 残留只多一次 302，不泄露数据）
3. [ ] 平台 admin 调整 org.capabilities → 30s 内生效，无需重登
4. [ ] 机构 admin **不能**修改自己的 capabilities（无入口/接口拒绝）
5. [ ] 邀请：A 发邀请 → 被邀请人 `GET /invitations/mine` 可见 → accept 后写入 org_members
6. [ ] `max_members` 达上限时邀请接口拒绝

### B. 资源 org 化 + 可见性（analyst 规则）

7. [ ] N 创建项目 → 自动 `org_id=aivestor, owner_id=N`（collaboration 开通时）
8. [ ] P/A 可见**全部**组织项目；N 仅见自己 owner 的 + 被共享的
9. [ ] N 的项目，P 打开详情页可见（页面已 scoped）；其子资源（文档/报告/会议/投后）P 均可见
10. [ ] N 对**非自己**且**未共享**的组织项目：详情页 404、各 API 404/403
11. [ ] 子资源 org_id 跟随：N 在自己组织项目下上传文档/写判断/生成报告 → 行 `org_id=aivestor`

### C. 共享

12. [ ] N（owner）或 P/A 在项目页「共享给成员」选择 N2 → N2 可见该项目并可编辑（共享=可见+可编辑）
13. [ ] 取消共享后 N2 不可见
14. [ ] 成员被移出且名下有 owner 项目、未带 `transferOwnerTo` → DELETE 成员返回 409 + 待交接清单；带上接收人 → 事务交接成功，共享关系清理

### D. 转入组织

15. [ ] N 的**个人项目**（org_id NULL）→「转为组织项目」二次确认 → 项目 + 五张子表（documents/reports/investment_judgments/meeting_notes/post_investment_updates）全部打上 org_id，owner=N；知识库条目**不**随迁
16. [ ] 转入不可逆（无反向入口）

### E. 投委会总报告（committee）

17. [ ] 组织项目下，P/A 选 ≥2 份报告 merge → 源报告放宽到组织成员的报告均可入选
18. [ ] 多成员已录判断时，总报告含 `## 合伙人观点对比` 章节，分歧并列呈现、不抹平
19. [ ] merge 产物 `kind='committee'`、`org_id=aivestor`
20. [ ] N 对组织项目的总报告：查看/导出（export, export-ppt）/refine/digest 均 404 或不可见（analyst 不可见 committee）
21. [ ] N 调 `GET /judgments/aggregate` → 403；P/A 调 → 返回按人分组的 MemberJudgments[]
22. [ ] 个人版账号 merge 产出与改造前一致（无「合伙人观点对比」章节）

### F. 评论

23. [ ] 组织项目详情页「团队评论」可发评论 / 单层回复；删自己的；A 可删任意
24. [ ] 个人项目无评论入口（comments GET 返回 []，POST 返回 400）

### G. 机构知识库 + 注入

25. [ ] N 在知识库列表对自己条目点「分享到机构知识库」→ 晋升为 `visibility='org'`（移动非复制，无新增重复条目）
26. [ ] 晋升后，**其他**组织成员（开通 org_knowledge）检索可命中该条目；知识库「机构沉淀层」tab 显示该条目带【机构沉淀·作者名】标识
27. [ ] 作者或 A 撤回（demote）→ 回到个人私有层，其他成员检索不再命中
28. [ ] 有机构沉淀的组织成员生成报告（reports / brief-analysis / skills/run / merge）→ system prompt 含「## 机构知识沉淀」段（≤5 条、单条 ≤300 字符、带【机构沉淀·作者】前缀）
29. [ ] 关闭 org_knowledge 能力位后 → 注入段消失、晋升入口与机构层 tab 不可用

---

## 四、能力位纯洁性自查

- [ ] `grep -rnE "协作版|数据增强版|tier ===|plan === 'org'" src/` 无业务代码命中（版本名仅存在于文档）
- [ ] 能力位判断只经 `orgAuth` 的 `hasCapability` / `getCapabilityNumber` / `requireCapabilityAPI`

---

## 五、本批次改造文件清单

**迁移（3，未自动执行）**：`021_org_resource_columns.sql`、`022_org_knowledge_visibility.sql`、`023_collaboration.sql`

**新增 lib**：`resourceAccess.ts`、`orgInject.ts`（含 injectMarketContext 签名占位）、`knowledgeSearch.ts`

**改造 lib**：`memoryContext.ts`（换三层入口）

**新增 API**：`projects/[id]/transfer-to-org`、`projects/[id]/comments`(+`[commentId]`)、`projects/[id]/shares`、`projects/[id]/judgments/aggregate`、`knowledge/[id]/promote`、`knowledge/[id]/demote`

**改造 API（24 路由 + merge）**：projects 全家、skills/run、skills/custom(+[id])、reports/[id](refine/export/export-ppt/digest)、knowledge(route/search/upload)、reports/merge

**新增组件**：`CommentPanel.tsx`、`JudgmentsByMember.tsx`、`ShareControl.tsx`

**改造页面**：`projects/[id]/page.tsx`（scoped 访问 + 传 org 上下文）、`knowledge/page.tsx`（层切换 + 晋升入口）、`ProjectDetail.tsx`（协作区）

---

## 六、明确不在本批次

迁移 024/025/026、zjjr 全部、数据应用框架（P5/P6）、org 档案/Dashboard/LP 报告/协会报告（P4）、`injectMarketContext` 实现（P6，已留签名占位）。
