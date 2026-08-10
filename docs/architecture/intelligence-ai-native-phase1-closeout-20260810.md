# Aivestor Intelligence AI-Native Phase 1 Closeout

日期：2026-08-10

## 1. 长期架构原则

Aivestor Intelligence 定位为面向股权投资场景的 Deep Research Environment，不是新闻规则处理流水线。

### AI First / AI Native

大模型能够完成的语义、理解、研究、判断、综合工作，不重新用程序规则实现。

AI 负责：

- 理解研究任务
- 规划搜索
- 自主追加查询
- 阅读资料
- 事实判断
- 相关性判断
- 综合分析
- 形成最终研究答案

系统负责：

- Search / Browser / `read_url` 等工具
- Provider Adapter
- Evidence / Provenance
- 权限
- 安全
- URL / SSRF 防护
- Token / 时间 / 成本预算
- 持久化
- 配额
- 薄发布边界

不通过公司名单、regex、关键词 supervisor、硬编码搜索词等方式修 benchmark 漏项。

Research Model 与 Research Infrastructure 解耦：同一套 Research Agent / Search / Browser / Evidence 基础设施可以运行不同 Provider / Model。

最终目标是模型升级时系统能力自然提高，而不是每换一个模型就重新实现一套 Intelligence Pipeline。

## 2. Phase 1 已完成内容

### 2.1 AI-Native Research 主链

```text
用户情报任务
    ↓
AI Research Agent
    ↕
Research Infrastructure
  - Search Router
  - Browser / read_url
  - Evidence / Provenance
  - Research Budget
    ↓
AI Research Report
    ↓
Thin Publication Boundary
    ↓
BriefResult / DB / UI
```

`AiNativeResearchReport` 已成为核心研究输出。AI 最终 `answer` 是一等公民，structured `items` 是同一研究结果的结构化视图，禁止再经过第二套语义重写系统。

### 2.2 已完成能力

- Agentic multi-turn research
- 自主 search
- `read_url`
- Evidence
- Final JSON repair
- Publication repair
- Research telemetry
- one-off Intelligence task
- Qwen Function Calling / multi-turn protocol 验证

DeepSeek 已通过真实 AI-Native Research 验证。

Qwen `qwen-plus` 已真实通过完整多轮协议：

```text
assistant/tool_calls
    → tool
assistant/tool_calls
    → tool
    → final
```

Qwen 复用通用 `completeChatWithTools`，不需要 Qwen 专属 Research Pipeline。

对应 commit：

```text
2c759a2f96d3e31795380196d6d30c4ce2207195
feat(ai): enable qwen agentic research
```

## 3. 当前生产状态

以下状态为 2026-08-10 阶段收口记录。

### Aivestor.cn

production HEAD：

```text
7c1a1dde38ef700132af10b4d6d0836273e32526
```

`origin/main`：

```text
2c759a2f96d3e31795380196d6d30c4ce2207195
```

Provider：DeepSeek
默认模型：`deepseek-v4-flash`

状态：

- AI-Native Research 已验证
- 生产质量当前明显高于中鉴
- 尚未部署 `2c759a2`
- `7c1a1dd` 与 `2c759a2` 的生产功能差异主要是 Qwen agentic capability，对当前 DeepSeek 主链无实质行为变化

### aivestor.com.cn / 中鉴智投

production HEAD：

```text
2c759a2f96d3e31795380196d6d30c4ce2207195
```

Brand：`zhongjian-zhitou`
Provider：Qwen
当前模型：`qwen-plus`

状态：

- DB migrations 045 / 046 已执行
- Intelligence 页面正常
- Qwen Agentic Research 已上线
- build / PM2 / health 正常
- 实际页面结果相比旧 AI-first 路线已有明显提升
- 但整体研究质量仍明显低于 Aivestor.cn / DeepSeek

## 4. Production Code Baseline

当前 Aivestor.cn 与中鉴生产 HEAD 暂时不同：

```text
Aivestor.cn: 7c1a1dd
中鉴:        2c759a2
```

这是短期可接受状态，但不是目标架构。

长期原则：

1. 两个品牌原则上使用同一代码基线。
2. 品牌、Provider、Model、数据库、额度等差异通过配置解决。
3. 不重新长期维护中鉴专属代码分支。
4. 不允许两个生产站长期漂移形成两个产品代码版本。
5. 在下一阶段 Intelligence 开发开始前，建议择机将 Aivestor.cn 正常升级到 `2c759a2`，重新建立统一生产代码基线。
6. 当前不需要为了统一版本立即进行额外生产部署；该事项列为下一阶段开始前的运维收口项。

## 5. 当前已知问题

### P1 — Research Model 质量差异

在相同 AI-Native Research 架构下，DeepSeek V4-Flash 明显优于 Qwen-plus。

Qwen-plus 主要问题：

- 研究主题边界容易漂移
- “大模型企业”容易扩展至机器人、半导体、ETF、政策等旁支
- 核心资本事件召回稳定性不足
- 高价值事件可能漏掉
- 来源选择与核验深度不足
- 投资判断偶尔超过证据支持程度

现阶段已经基本排除“两个站代码架构不同”作为主要原因。剩余质量差异主要来自 Research Model 与 Research Infrastructure / Retrieval。

不要针对上述现象重新增加公司名单、关键词规则、资本事件 regex 或 semantic supervisor。

### P1 — Retrieval / Search Infrastructure

当前是主要基础设施瓶颈。

Qwen Agentic A/B 中：

```text
Qwen native retrieval: failed / upstream_error
Bailian Web:           success
```

系统按既有设计回退到 Bailian Web，因此目前整个 Research Agent 对 Bailian Web 依赖较重。

已知风险：

- 重要报道可能漏召回
- 权威来源覆盖不稳定
- Reuters / 交易所 / 公司公告 / 官方披露等未必进入候选
- 搜索结果质量决定 Agent 能力上限
- 单搜索源存在天然 recall ceiling

### P2 — `qwen3.7-max` 尚未完成质量验证

已执行唯一一次真实 A/B：

```text
provider=qwen
model=qwen3.7-max
```

失败原因为 AI 服务响应超时：60s 无数据，没有完整 FINAL ANSWER。

目前不能据此判断 `qwen3.7-max` 模型质量不行。可能原因包括：

- thinking 模式首响应时间较长
- 当前 60s idle timeout 与模型行为不匹配
- Agent tool turn 可能需要更合理的 streaming / timeout 策略

本轮不继续修复。

### P2 — Publication / UX

当前页面已经可用，但仍存在：

- overview 还可更精炼
- Fact 与投资判断层次可进一步清楚
- context 信息仍可能占据注意力
- 来源可信度呈现仍可提升
- 文风有时偏研究报告而非投资人高效情报简报
- 需要进一步减少用户阅读负担

原则：优先改善 AI 输出能力与薄发布层，不重新建设复杂规则流水线。

## 6. 下一阶段：`RESEARCH_INFRASTRUCTURE_PHASE2`

### 6.1 Multi-source Search Infrastructure

增加至少第二个独立 Web Search Provider。

目标：

```text
Search Router
  → Provider A
  → Provider B
  → future professional sources
```

Router 只负责 provider orchestration、dedupe、diagnostics 和 availability，不承担研究语义判断。

重点提升 Recall、权威来源覆盖、搜索稳定性以及中文 / 英文跨语言检索能力。

### 6.2 Authority / Professional Sources

逐步探索并接入：

- 公司公告
- 交易所
- 证监会及监管披露
- Reuters / Bloomberg 等高质量媒体
- 财经媒体
- 投融资数据库
- 工商 / 企业数据
- 专业金融数据源

这些均应作为 Research Tools / Sources，而不是写死进研究逻辑。

### 6.3 Adaptive Deep Research

增强 Agent 自主研究链路：

```text
first search
  → assess gaps
  → reformulate query
  → second search
  → read
  → identify uncertainty
  → backtrack / cross-check
  → final
```

Research Budget 长期应更偏向 time、tokens、cost，而不是固定“必须搜索几次”。

### 6.4 Model A/B

在同一 Research Infrastructure 下继续比较：

- DeepSeek V4-Flash
- Qwen-plus
- Qwen3.7-max
- 后续可用强模型

选择默认模型的唯一核心标准是：真实投资任务结果质量 / 成本 / 延迟综合最优。不能因为品牌或 Provider 一致性而牺牲产品质量。

### 6.5 `qwen3.7-max` Runtime Compatibility

后续单独评估：

- thinking on/off
- streaming tool calling
- first-token timeout
- idle timeout
- tool round timeout

不要把某一模型专属行为污染 Research Kernel。

### 6.6 Publication Experience

在 Research Quality 稳定后再进行：

- 简报信息架构
- overview
- event cards
- evidence/source display
- investor commentary
- uncertainty display
- reading density

目标是“投资人真正愿意每天看的情报简报”，而不是展示内部研究流程。

## 7. 明确不做的方向

- 不为 DeepSeek / 月之暗面 / MiniMax / 智谱等公司写硬编码
- 不建立“中国大模型企业固定名单”作为主要研究机制
- 不用 regex 替代 AI 判断资本事件
- 不增加复杂 semantic supervisor
- 不重建第二套 Qwen Intelligence Pipeline
- 不让 publication layer 重新解释 AI Research Report
- 不因为一次 benchmark miss 重新退回规则系统

## 8. 待办清单

- [ ] Aivestor.cn 择机升级到 `2c759a2`，恢复两站统一代码基线
- [ ] Research Infrastructure Phase 2 设计
- [ ] 第二 Web Search Provider
- [ ] 权威 / 专业来源覆盖方案
- [ ] Adaptive Research / backtracking
- [ ] `qwen3.7-max` runtime compatibility
- [ ] 同基础设施模型 A/B
- [ ] Intelligence publication UX 后续专项

## 9. 阶段收口判断

Phase 1 已建立可复用的 AI-Native Research 主链，并完成 DeepSeek 与 Qwen agentic tool protocol 的基础接通。当前主要矛盾已从“是否存在 Agent 主链”转移到 Research Model 质量差异与 Search / Retrieval 基础设施上限。

后续工作应优先增强 Research Infrastructure、来源覆盖和模型真实 A/B 能力，保持 Research Model 与 Infrastructure 解耦，并继续遵守 AI 负责研究语义、系统负责工具与边界的架构分工。
