# 情报执行核心 V2：本地实施与验收记录（2026-11-04）

## 结论

已从 `f33073d6903076fdc6d923519ecb27267a1cc3b5` 建立独立工作树和分支，停止继续修补旧多轮 Agent，完成第一条可恢复的确定性执行竖切：

`用户原话/结构化范围 → 有界检索 → 候选立即落库 → 正文取证 → 单次结构化事实提取 → 本地确定性简报 → 原子发布`

本轮没有调用任何收费供应商，没有读取或复制已保存 Key，没有连接生产数据库，也没有 push、merge 或部署。

## 工作区

- 工作树：`D:\Projects\Aivestor-intelligence-core-v2`
- 分支：`codex/intelligence-core-v2-20261104`
- 基线：`f33073d6903076fdc6d923519ecb27267a1cc3b5`
- 旧工作树 `D:\Projects\Aivestor-intelligence-redesign` 已冻结，仅作为取证备份。
- 新工作树未复制 `.env`、Key、数据库或旧 artifacts。

## 保留、替换与新增

保留并复用：

- Topic / Run / Brief / History 工作空间与旧历史兼容；
- owner 权限、幂等键、租约、计划任务、配额和外部调用持久账本；
- DeepSeek Search 的单次授权、费用上限、零自动重试及安全来源元数据；
- 旧成果继续可读，归档不删除历史。

替换生产 worker 的研究执行入口：

- 新增 `src/lib/intelligencePipeline.ts`；
- 不再让生产 worker 走开放式多轮工具 Agent、末尾大 JSON、模型 repair/forced-finalization；
- Search batch 返回后先写 `intelligence_run_evidence`，再进入后续阶段；
- facts 只允许一次外部生成，模型结果必须引用已持久化 `evidenceId`；
- 事实必须在同一条引用证据中同时绑定主体、事件动作和必要的轮次/金额要素；精确事件日还必须与该主体和事件绑定，否则仅移除日期或拒绝发布该事项；
- 金额、比例、融资轮次、投资方、交易对手和领投/跟投等角色逐项对照支持该事件的具体来源；任一具体属性无证据时，该模型事项不会作为事实发布；
- 中英文货币金额先规范为币种及统一的百万基数再比对；`1亿美元` 与 `$100 million`、`人民币10亿` 与 `10亿元` 均可识别为同一属性，金额内数字不再被通用数字门禁二次误杀；币种代码加金额也不会再被误认成事件主体；
- 英文机构后缀与参与方实体纳入同一实体门禁，避免 `Sequoia Capital` 等无来源参与方进入标题或摘要；
- 未被事件分类词典识别、但主体和具体属性均有来源的动作保守保留为“待核实线索”，不会因关键词缺失静默删除，也不会升级成事实；
- 已取得正文时，搜索标题不能覆盖无关或矛盾的正文；
- 模型调用已完成但结构无效时不自动重放；
- 最终概览由本地根据通过门禁的事项数和覆盖状态生成，不再复用模型输出的“其他事项均不存在”等未经支持的否定；
- 粗覆盖空结果只显示“资料不足/无法判断”，不发布“没有新事项”。

新增持久层：

- `db/migrations/053_intelligence_pipeline_checkpoints.sql`
- 阶段：`understanding / retrieval / evidence / facts / brief`
- checkpoint 与 evidence 都按 `(run_id, user_id)` 归属；
- 终态发布不再先删除阶段证据；
- diagnostics 只保存安全结构摘要，不保存 Key、完整 prompt、整页正文或思维过程。

## 恢复语义

- 检索候选已落库、没有未结算调用、且事实生成尚未开始：旧租约可回收，从候选继续，不重复 Search。
- facts 为 `running/uncertain`：保守阻断，避免重复模型扣费。
- 已完成但无效的模型输出：facts 标记 `externalCallCompleted=true`，自动重跑被拒绝。
- provider 持久账本仍是每个收费出口的硬门；阶段 checkpoint 不能绕过预算。
- 保持现有 PostgreSQL `FOR UPDATE SKIP LOCKED` worker；本竖切没有引入外部队列框架，因为已有租约、幂等和事务足以覆盖当前吞吐，新增框架只会增加双写和运维复杂度。

## 产品可见改进

- 主题页继续优先展示旧成功成果，新一期失败/运行中不会覆盖历史简报；
- 运行中显示当前阶段，例如“核验正文”；
- 运行记录显示阶段和状态；
- 历史简报入口保持按主题可发现；
- 运行详情 API 返回 owner-scoped checkpoints 与 evidence；
- 用户原始请求写入任务和 immutable run snapshot，复杂任务理解不再只剩字段名。
- 原始请求、关键词、地区、最大事项数、来源策略和个性化上下文同时进入前两条有界查询、understanding checkpoint 与事实提取提示；
- 用过 DeepSeek 单次费用授权的失败 run 不再显示“重试同一运行”，API 也返回 409；用户必须重新勾选授权并创建新 run，避免无授权伪重试。

## 验收证据

以下均在新工作树、本地离线环境完成：

1. `tsc --noEmit --incremental false`：通过。
2. `npm run test:intelligence`：通过；包含原情报回归及新确定性流水线 10 个故事。
3. 新流水线纯函数 10 个故事：
   - 正常竖切只检索一次、取证一次、生成一次；
   - 完成后恢复不重复检索/取证/生成；
   - 粗检索零结果显示资料不足且不调用生成；
   - Search checkpoint 后进程中断，候选保留并恢复；
   - 已完成但引用未知 evidence 的无效输出不自动重放。
   - 另一家公司日期不会借给目标公司；相关事件可保留，但错误精确日会被移除；
   - 完全无关证据无法发布目标公司事项，模型概览中的“未发生任何事项”不会进入最终简报；
   - 地区、关键词、maxItems、sourcePolicy、个性化范围和用户原话进入查询、checkpoint 和生成提示。
   - 来源未披露金额和投资方时，模型添加的“10亿元、红杉资本领投”整条不发布；来源逐项支持时正常保留；
   - “股权转让”等未知动作在主体、交易对手均有来源时降级为线索而非事实。
   - `$100 million`、`USD 100m`、`RMB 500 million` 及英文投资方缺少来源时均不发布；`1亿美元`↔`$100 million`、`人民币10亿`↔`10亿元` 的等价格式可正常保留；来源仅称 `participated` 时，模型不得升级为 `led the financing` 或 `was the lead investor`。
4. 隔离 PostgreSQL（`127.0.0.1:55435/aivestor_core_v2_test`）6 个故事通过：
   - 真实子进程在 Search checkpoint 后硬退出，旧租约回收后不重复检索，保留 evidence 并形成 brief；
   - facts 阶段中断保持 blocked/uncertain，不自动重复付费。
   - 用户 B 无法读取或写入用户 A 的 checkpoint/evidence。
   - 实际 worker 路径验证错误主体日期被移除；无关证据与否定概览被降级为证据不足。
   - 实际 worker 路径验证等价的中英文人民币/美元金额可进入 brief，同时 `participated` 不会被错误升级为 `lead investor`；未知股权转让动作以 clue 落库。
   - 六故事原始输出：`artifacts/intelligence-core-v2/postgresql-six-stories-20261104.log`，包含 Search checkpoint 后真实子进程强制退出及恢复证据。
5. `npm run build`：最终源码完整生产构建通过，82/82 静态页面生成，BUILD_ID=`lmjIgAONSHyN1Ecl-t_N6`；仅有 caniuse-lite 过期提示。构建关键原始输出保存在 `artifacts/intelligence-core-v2/build-final-20261104.log`。
6. 最新生产构建 + 真实 Next/API/Chrome 浏览器：2/2 通过。
   - 登录隔离账号；
   - 主题页显示“运行中 / 当前阶段：核验正文”；
   - 旧成果仍可读；
   - 历史简报和运行记录入口可用；
   - 用过单次费用授权的失败 run 显示重新授权指引，不展示直接重试；直接 POST 重试 API 返回 `409 / fresh_external_authorization_required`；
   - 实际 worker 生成的隔离 brief 经 owner-scoped API 到 UI：无依据金额、投资方及否定结论不可见；有来源但未分类的股权转让显示在“待核实线索”；
   - 375px、deviceScaleFactor=2 下无横向溢出，阶段和历史 tab 可见。
   - 截图：`artifacts/playwright-intelligence/pipeline-v2-topic.png`（仅合成测试数据）。
7. `git diff --check`：无空白错误；只有 Windows 行尾提示。

证据层级说明：PostgreSQL 测试使用真实 worker、真实表和真实硬退出，但供应商 transport 为受控离线实现；浏览器测试使用真实 Next/API/Chrome 和合成隔离账号数据。两者都不是付费供应商质量验收，不能据此声称真实召回率通过。

测试容器 `aivestor-intel-core-v2-pg` 已停止但未删除，隔离数据保留供复核。已保存 DeepSeek Key 的旧测试数据库未被启动、重建或修改。

## 尚未放行的范围

- 没有真实供应商端到端调用，因此不能宣称实际检索质量、召回率或中文投资事件质量已通过。
- migration 053 只应用到新隔离测试库，未应用生产。
- 新分支未提交、未推送、未合并、未部署；当前线上仍是旧版本。
- 首次真实竖切应另行取得费用授权，建议固定为：同一公开主题、DeepSeek-only、最多 2 次 Search、1 次 Generation、0 次供应商 Fetch、无自动重试；沿用持久 USD 账本并在费率重新核实后给出硬上限。
- 若首次真实竖切失败，应直接从已持久化 checkpoint/evidence 定位，不再用增加调用次数掩盖问题。

## 回退

- 代码回退：不合并本分支即可；旧工作树和基线均保留。
- 数据回退：053 为纯新增表；旧 task/run/brief/evidence 不改写。回退应用版本时可保留 checkpoint 表，不影响旧读路径。
- 不建议在验证前删除 053 数据；它是失败诊断和证据恢复依据。
