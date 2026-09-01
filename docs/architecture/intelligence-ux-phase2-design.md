# Aivestor Intelligence UX Phase 2 设计方案

日期：2026-08-14
状态：设计方案（评审用，不含业务代码实现）

> 强制约束：本方案及后续实现必须遵循 [`../product/product-development-principles.md`](../product/product-development-principles.md)。情报订制应默认理解并执行，使用常理补全非关键配置，不得把参数填写、程序字段或重复确认转嫁给用户。

## 1. 目标与设计原则

### 1.1 定位

Aivestor Intelligence 是"面向投资人的持续市场感知能力"，而不是新闻流、任务配置后台或定时推送工具。本阶段目标：把 Intelligence 从**任务配置后台**升级为**投资人每天愿意打开看的情报工作台**。

用户打开 Aivestor 后，应先快速知道"最近发生了什么与我有关的变化"，再自然进入深入研究、查看来源、继续追问、创建持续关注、关联到项目 / 赛道 / 企业。

### 1.2 信息层次主线

页面信息组织按以下优先级：

1. 今天 / 最近值得关注什么
2. 为什么值得关注
3. 与我的投资方向有什么关系
4. 事实与来源
5. 深入研究 / 持续关注

调度配置、执行模式、系统内部状态和技术字段可以存在，但应按需出现，不占注意力。

### 1.3 产品约束

- **不主动推送**：站内、邮件、短信、微信主动推送均不做。情报内容统一驻留工作台入口聚合，遵循产品哲学"提醒是温和的回看线索，不是压力放大器"。
- **不制造焦虑**：不使用"你已经 N 天没关注"这类表述；推荐"你在 3 周前关注的项目，有新进展吗"这类自然语言。
- **保持发现能力**：个性化不能形成信息茧房，系统保留发现重大意外变化和跨赛道机会的能力。

### 1.4 架构红线（沿用 Phase 1 Closeout）

- AI 负责研究语义与判断；系统负责工具、来源、权限、预算与薄发布边界。
- 不重建研究管线，不加规则兜底，不因一次 benchmark miss 退回规则系统。
- 不用 regex / 固定名单 / semantic supervisor 替代 AI 判断资本事件与重要性。
- publication layer 不得重新解释 AI Research Report，只做最薄格式约束。

## 2. 现状与问题诊断

### 2.1 现状盘点

| 层 | 现状 | 关键文件 |
|----|------|---------|
| 研究主链 | AI-Native Research（三路分发），DeepSeek/Qwen 均已验证 | `src/lib/intelligence.ts`、`src/lib/intelligenceAgentRuntime.ts` |
| 检索 | Bailian 为主，Tavily 适配器已存在但未实际启用 | `src/lib/intelligenceProvider.ts`、`src/lib/intelligenceTavilyAdapter.ts` |
| 简报质量 | 分桶、线索判定、投资观察、证据分级已具备 | `src/lib/intelligenceBriefQuality.ts`、`src/lib/intelligenceEvidence.ts` |
| 工作台入口 | "今日关注"卡片：仅最新 5 条平铺 + 查看全部 | `src/components/dashboard/IntelligenceAttention.tsx`、`src/app/(app)/dashboard/page.tsx` |
| 简报页 | 概览 Markdown + 三桶列表 + 反馈按钮，信息密度高 | `src/components/data-apps/IntelligenceSubscriptions.tsx` |
| 个性化 | `user_profile` 已注入生成 prompt，但候选未按用户画像/项目库重排 | `src/lib/user-profile.ts` |

### 2.2 核心问题

1. **入口信息价值低**：工作台"今日关注"只平铺最新 5 条，未区分重要/趋势/线索，未说明"为什么与我有关"。
2. **简报可读性不足**：overview 偏研究报告文风、事件卡信息密度高、来源可信度未可视化（S/A/B/C 分级已存在于数据但未呈现）、不确定性标注不显眼。
3. **个性化未闭环**：画像只影响生成语气，未参与相关性排序与呈现。
4. **检索单源瓶颈**：Qwen native retrieval 失败率高，实际主要依赖 Bailian Web，权威来源覆盖不稳定。

## 3. 竞品对比结论（设计依据）

| 能力 | AlphaSense | CB Insights | 结论对 Aivestor 的借鉴 |
|------|-----------|-------------|----------------------|
| Deep Research Agent | Deep Research 投资级 briefing | ChatCBI + Team of agents | 已有主链，属领先项，本阶段不重建 |
| 引用溯源可审计 | 强项 | 强项 | 已有 Evidence，需在 UI 强化呈现 |
| 持续监控 / 定时 | Workflow Agents + Monitoring | Personal Briefing（24/7） | 调度器已开发未启用，本阶段不在 UX 范围外扩大 |
| 主动推送 | Alerts + 移动端 | Personal Briefing | **有意不做**（产品哲学约束） |
| 个性化 | 定制 Dashboard | 个人研究库 | 借鉴"与我的组合相关"的信号呈现 |
| 来源可信度 | 统一权威内容库 | 统一数据库 | 借鉴：把来源分级做进阅读体验 |

核心借鉴：竞品普遍把情报做成"每天/每周自动到位的、与我的组合相关的、可追溯的高价值简报"。Aivestor 本阶段在"不推送"约束下，把同等价值放回**工作台入口的信息聚合**。

## 4. 工作台"今日关注"重构（P1）

### 4.1 现状

`src/app/(app)/dashboard/page.tsx:189-194` 取最新一条简报，`IntelligenceAttention.tsx` 平铺前 5 条 items（`IntelligenceAttention.tsx:90`），未按 importance / relevance 分级。

### 4.2 目标结构

"今日关注"卡片从单条平铺列表升级为**分层信息卡片**：

1. **本期概览行**（若有 metadata.overview）：一句话总体情况。
2. **重点动态**：`important_facts` 中 `importance === "high"` 的条目，最多 3 条，展示标题 + 1 句摘要 + 来源分级标签。
3. **值得关注**：`importance === "medium"` 或趋势类，折叠展示，最多 3 条。
4. **线索**：`isClue` 条目，弱化展示（"待进一步确认"）。
5. **动作区**：生成本期简报 / 管理订制 / 查看全部（保留现状），新增"深入研究"入口（跳转情报订制页对应简报）。

### 4.3 数据接口

`dashboard/page.tsx` 的 `IntelligenceBriefRow` 增加按 importance 分组的透传；`IntelligenceAttention` 的 `DashboardIntelligenceBrief.items` 扩展为携带 `importance`、`relevance`、`sourceTier`、`isClue` 的字段（仅透传已有 `Candidate` 字段，不新增语义重写）。

### 4.4 多任务切换

有多个活跃任务时，"今日关注"顶部提供任务名切换（tabs），默认展示最近生成简报所属任务；无简报时保持现状引导。

### 4.5 验收

- 工作台能区分重点动态/值得关注/线索三层展示。
- 无任务 / 额度不足 / 无简报三种状态的引导保持自然，无焦虑表述。
- 多任务切换可用。

## 5. 简报阅读体验（P1）

### 5.1 现状

`IntelligenceSubscriptions.tsx` 的 `BriefSection`（`:167-186`）以统一 article 卡呈现，来源以纯文本拼在底部（`:181`），来源分级未可视化，阅读密度偏高。

### 5.2 目标结构（单条事件卡）

1. **标题**：事实化、去炒作（已由 `intelligenceBriefQuality.ts` 保障）。
2. **摘要**：1～2 句事实摘要。
3. **投资观察**（有证据时）：与摘要分离、视觉层级区分。
4. **来源可信度**：S / A / B / C 分级徽标（数据已存在于 `Candidate.sourceTier`），S 级（官方/监管/交易所）用绿色强调。
5. **不确定性标注**：`timeUnconfirmed`（时间未确认）、`isClue`（单一模糊来源，线索）、`evidenceStatus`（full / partial / unavailable）以弱化样式呈现，不与事实混排。
6. **证据状态提示**：`metadata.retrieval.status === "partial"` 的全局提示（现状已有，保留）。

### 5.3 overview 精炼

- `metadata.overview` 已由 AI 生成；前端仅做排版强化（不再二次改写）。
- 目标文风：投资人高效简报，非研究报告。该约束在生成侧由 `intelligenceBriefQuality.ts` / Publication Repair 承担，前端不重写。

### 5.4 单条动作入口（入口先行，后端可后置）

每条事件卡提供：
- **深入研究**：跳转一次性研究入口（预填该事件主题）。
- **创建持续关注**：跳转自然语言创建（预填模板文本）。
- **关联到项目**：跳转项目选择（如项目联动未上线则隐藏）。

注：本阶段交付为入口与占位交互，具体后端预填逻辑作为后续实现项，不在本文档强制范围内。

### 5.5 验收

- 事件卡区分事实 / 投资观察 / 线索 / 时间未确认的视觉层级。
- S/A/B/C 分级徽标正确渲染。
- overview 渲染不丢失、不重复。

## 6. 个性化排序与相关性呈现（P2）

### 6.1 设计原则

遵守 AI-first：相关性判断由 AI 完成，程序不建规则排序管线。`Candidate.relevance`（high/medium/low）字段已存在，由研究阶段 AI 标注。

### 6.2 排序信号

- **用户画像**：`user_profile` 的 `focus_sectors` / `focus_stages` / `investment_style` 已通过 `formatProfileForPrompt` 注入生成 prompt，本阶段扩展为让 AI 在输出中对每条候选标注 `relevance`（相对用户画像与关注范围）。
- **项目库联动**：用户 active/invested 项目对应的公司/赛道出现重大变化时，AI 在研究中优先确认并标注（信号来自画像与项目上下文注入，不建硬编码名单）。
- **反馈回流**：`intelligence_feedback` 的 valuable/irrelevant 可作为后续生成的上下文信号（加权提示），不做硬规则过滤。

### 6.3 UI 呈现

- 工作台与简报页对 `relevance === "high"` 的条目显示"与你的投资方向相关"标记。
- 高 relevance 条目在分桶内优先排列（仅排序，不隐藏 low）。
- 保留重大意外事件：即使与画像无关，`importance === "high"` 不降权、不隐藏。

### 6.4 不做

- 不建立"公司固定名单 / 赛道白名单"。
- 不用规则给 relevance 打分。
- 不因反馈过滤掉可能重要的事件。

## 7. Tavily 第二搜索源启用（质量基础）

### 7.1 现状

`src/lib/intelligenceTavilyAdapter.ts` 已实现（`topic: news` 适配），`IntelligenceRetrievalOrchestrator`（`src/lib/intelligenceProvider.ts`）已支持多 Provider 并行、URL 去重与诊断聚合。当前生产主要依赖 Bailian Web，Tavily 未实际启用。

### 7.2 接线设计

1. **配置开关**：env 增加 `TAVILY_API_KEY`；存在时 `IntelligenceRetrievalOrchestrator` 同时路由 Bailian + Tavily，独立 Provider 并行调用。
2. **失败语义**：任一 Provider 失败不阻断整体；沿用现有 failover，单源可用即返回。
3. **去重**：沿用现有 URL 去重，跨 Provider 合并同类结果。
4. **诊断**：`safeRetrievalMetadata` 聚合各 Provider 状态，页面"本期有部分来源无法访问"提示保持正确。
5. **成本控制**：Tavily 仅作为补充召回源，不做重复无谓调用（按现有检索编排语义执行）。

### 7.3 验收

- 本地开启 Tavily 后，检索 telemetry 可见两个 Provider 状态。
- 单 Provider 故障时整体生成仍成功。
- 去重后候选无跨源重复。

## 8. 数据与迁移

- **优先复用现有 schema**：`intelligence_briefs.metadata`（研究元数据）、`Candidate` 已含 importance / relevance / sourceTier / isClue / evidenceStatus，无需迁移即可支撑 4、5、6 章 UI 改造。
- **轻量迁移评估**：若个性化重排需持久化（如任务级画像快照、relevance 排序结果落库），评估增加字段或复用 metadata JSONB；**不做**则不加表。此项在实现阶段视需要决策，本文档不预设迁移。
- 历史简报无新字段时按"无标记"展示，不阻断。

## 9. 里程碑与验收标准

| 里程碑 | 内容 | 验收基准 |
|--------|------|---------|
| M1 | 工作台"今日关注"分层重构 | `npx tsc --noEmit`、`npm run build`、页面视觉走查、无焦虑表述 |
| M2 | 简报事件卡体验改造 | 视觉层级、来源分级徽标、不确定性标注正确 |
| M3 | 个性化相关性呈现 | AI 输出 relevance 标注、UI 标记与排序正确、high importance 不被隐藏 |
| M4 | Tavily 启用 | 双 Provider 诊断、failover、去重验证 |
| 全量 | 回归 | `npm run test:intelligence`、`npm run test:e2e:intelligence`（Playwright）通过 |

## 10. 不做清单

- 不做站内 / 邮件 / 短信 / 微信主动推送。
- 不重建 AI Research / 第二套 Qwen Pipeline。
- 不引入规则排序、公司固定名单、semantic supervisor 作为研究机制。
- 不让前端重新解释 AI Research Report 语义。
- 不做移动端、浏览器插件（另行评估）。
- 不在本阶段扩展结构化融资 / 估值数据维度（另行立项）。

## 11. 与 Phase 2 其他主线的衔接

- 本文档覆盖 **P1-C（UX）** 主体与部分 **P1-B（任务体验）** 的动作入口。
- **P1-A（检索质量）** 的 Tavily 启用作为质量基础并入，权威来源覆盖、模型 A/B 由 RESEARCH_INFRASTRUCTURE_PHASE2 独立推进。
- 升级后保持 Research Model 与 Infrastructure 解耦，模型换新不影响本文档 UI 结构。
