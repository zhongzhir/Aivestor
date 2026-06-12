# Hotfix：知识晋升"移动变复制"——个人层列表遗漏 visibility 过滤

> 类型：bug 修复 + 人工验证步骤
> 日期：2026-06-12
> 前置：P2/P3 已部署（commit `e95e719`），迁移 021/022/023 已执行
> 触发：晋升后条目同时出现在「个人层」与「机构沉淀层」两个 tab

---

## 一、根因结论

**根因是 (b)：列表查询遗漏 visibility 过滤，不是 (a) 数据复制。**

- `POST /api/knowledge/[id]/promote` 实现确认为**原地 UPDATE**（不是 INSERT 新行）：
  ```sql
  UPDATE knowledge_base_entries
     SET org_id = $1, visibility = 'org', promoted_by = $2, promoted_at = NOW()
   WHERE id = $3
  ```
  晋升是移动，数据库中**仍是一行**，promote 路径不产生重复行。
- `GET /api/knowledge`（列表）的「个人层」分支原本是 `WHERE kb.user_id = $1`，**没有 `visibility` 过滤**。
- 架构 3.1 规定"条目始终保留原 user_id"——晋升只改 `visibility='org'`、`user_id` 不变。于是一条已晋升条目同时满足：
  - 个人层查询 `user_id = $1`（user_id 未变 → 命中）
  - 机构层查询 `org_id = $org AND visibility = 'org'`（命中）
  → 两个 tab 都显示同一行，造成"复制的视觉假象"。**根源是个人层查询少了 visibility 过滤。**

### 生产数据核查（只读，交人工执行确认）

用实际晋升过的条目关键词替换 `测试`：

```sql
SELECT id, user_id, org_id, visibility, promoted_by, promoted_at,
       left(content, 40) AS content_head, created_at
FROM knowledge_base_entries
WHERE content LIKE '%测试%'
ORDER BY created_at DESC;
```

预期：**该条目只有一行**，且 `org_id` 非空、`visibility='org'`、`promoted_by/at` 已填。

> 若上面查询返回**两行相同 content**（一行 private、一行 org），才说明历史上存在过 INSERT 式复制（本代码不会产生）。当前代码下不应出现；**无需任何清理 SQL**。若人工确认确有重复行，再单独评估 DELETE，不在本任务自动执行。

---

## 二、修复内容

`src/app/api/knowledge/route.ts` 的 GET，「个人层」分支加上 `visibility='private'`：

```diff
- baseWhere = "kb.user_id = $1";
+ baseWhere = "kb.user_id = $1 AND kb.visibility = 'private'";
```

机构层分支本就正确（`kb.org_id = $1 AND kb.visibility = 'org'`，$1 = 当前 org），未改动。

修复后该条目在数据库仍为一行，但：个人层 tab 不再显示（visibility 已是 'org'），机构层 tab 正常显示一次。

---

## 三、回归确认

- **未晋升条目（绝大多数存量）不受影响**：迁移 022 给 `visibility` 设了默认值 `'private'`，存量与新录入条目默认即 `private`，`WHERE user_id=$1 AND visibility='private'` 与原 `WHERE user_id=$1` 返回完全相同的行。
- **撤回（demote）一致**：`POST /api/knowledge/[id]/demote` 把条目置回 `visibility='private', org_id=NULL`。修复后——个人层查询 `user_id=$1 AND visibility='private'` 命中（条目回到个人层）；机构层查询 `org_id=$org AND visibility='org'` 不再命中（已离开机构层）。符合"撤回后从机构沉淀层消失、回到个人层"。
- `npm run build`：✓ 全路由通过。

---

## 四、AI 注入（9.3）人工验证步骤（修复部署后执行）

> 目的：确认 `injectOrgKnowledge` 真正把机构沉淀注入到生成 prompt。
> 代码侧已确认：`injectOrgKnowledge` 已接入 `/api/skills/run`、`/api/projects/[id]/reports`、
> `/api/projects/[id]/brief-analysis`、`/api/projects/[id]/reports/merge` 调用链；
> 机构层检索条件为 `org_id=当前org AND visibility='org'`（正确）。

1. **晋升一条有辨识度且足够长的条目**（关键：不要用"测试"这种短文本）。用 admin 账号在知识库手动录入一段**投资相关、带独特关键词**的内容，例如：
   > 「关于 SaaS 项目的尽调要点：我们机构特别关注净收入留存率（NRR）必须高于 120%，且对单一大客户收入占比超过 30% 的标的一律谨慎——独特暗号 ZEBRA-NRR-7788。」

   原因：机构层向量检索用项目的「名称+行业+阶段」作为 query，需与条目语义相关才能命中 top-K；且 `injectOrgKnowledge` 有最小 query 长度（10 字符）与向量相似度门槛，短文本"测试"几乎不可能命中。

2. 录入后点「分享到机构知识库」晋升（确认它在**机构沉淀层 tab 显示一次、个人层 tab 不再显示**——本次修复点）。

3. 在一个**已转入组织**的项目（最好是 SaaS/相关行业，使语义贴近条目）里触发「简要分析」或「生成报告」。

4. **期望**：生成的 system prompt 含 `## 机构知识沉淀` 段，每条带 `【机构沉淀·yuanlin zhang】` 前缀，且能看到独特关键词 `ZEBRA-NRR-7788` 或其语义影响。可在服务端日志打印 system prompt，或在报告产出中观察是否引用了该机构沉淀。

### 若注入仍无效，按此顺序排查（均已静态确认正确，供兜底）

- [ ] `injectOrgKnowledge` 是否在调用链：`brief-analysis/route.ts` 已在 `injectProfile` 之后链式调用（确认 import + 调用存在）。
- [ ] 机构层查询条件：`orgInject.ts` 用 `WHERE kb.org_id=$1 AND kb.visibility='org' AND kb.embedding IS NOT NULL`（向量）/ 同条件全文兜底——正确。
- [ ] **能力位**：当前 org 必须 `hasCapability('org_knowledge')===true`，否则 `injectOrgKnowledge` 直接返回原文（aivestor 已全开）。
- [ ] **embedding 命中**：晋升条目需有 embedding（录入时百炼可用才会生成）。若百炼未配置，走全文兜底，'simple' 分词对纯中文召回差——这也是要求"较长、含可被检索词的内容"的原因。
- [ ] **query 长度/相关性**：检索 query = 项目「名称+行业+阶段」，需 ≥10 字符且与条目语义相关；用与条目同赛道的项目测试。

---

## 五、附：同模式的第二处实例（后续补丁已修复）

`/api/knowledge/search`（知识问答）的**个人检索**子句原同样是 `WHERE user_id = $1`（无 visibility 过滤），作者本人搜索时自己已晋升的条目会在"个人检索"与"机构层增补"各出现一次。已在后续补丁中按同模式修复：向量检索与全文检索两处个人层子句均补 `AND visibility = 'private'`（commit `fix: knowledge search personal clause visibility filter`）。机构层增补（`searchLayeredKnowledge`，`visibility='org'`）与 document_chunks 检索（无 visibility 列、不涉及晋升）未动。
