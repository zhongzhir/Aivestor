# Aivestor AI-Native Research Infrastructure

## 1. 产品定位

Aivestor Intelligence 不是新闻采集或规则处理流水线，而是投资场景下的 Deep Research Environment。

```text
User Research Task
        ↓
AI Research Agent
        ↕
Research Infrastructure
 ├─ Search Router
 │   ├─ Web Search Provider A
 │   ├─ Web Search Provider B
 │   ├─ 专业金融/交易/公告数据源
 │   └─ 用户/机构私有数据源
 ├─ Browser / Read URL
 ├─ Evidence / Provenance
 └─ Research Budget
        ↓
AI ResearchReport
        ↓
Thin Publication Boundary
        ↓
Persistence / UI
```

## 2. AI FIRST

AI 负责理解任务、研究规划、查询设计、搜索方向调整、阅读选择、缺口识别、回溯、事实理解、事件日期和重要性判断、跨来源综合、投资分析与最终写作。

软件负责工具与 API、Search Provider 接入、Browser 安全、URL/SSRF 防护、来源追踪、权限、Token/成本/时间预算、持久化、明确格式约束及最薄安全边界。

新增任何规则前必须先回答：为什么不能直接让当前最强 AI 做？

## 3. 禁止重新走老路

不得重新建立 Claim pipeline、Verification Supervisor、Coverage Supervisor、Relevance Supervisor、公司或事件白名单、固定查询、benchmark hardcode、程序语义日期分类及程序重要性排序。

程序的 late constraints 只保护安全、来源可追溯、权限、资源预算和明确的发布格式，不接管研究判断。

## 4. Research Infrastructure 是未来重点

提升召回主要依靠更好的及多个 Search Provider、AI 自适应查询、Browser/read 能力、更合理的 Research Budget，以及跨轮次保持研究上下文，而不是规则补漏。

Search Router 只负责 Provider 编排、统一结果、诊断与 URL 去重；它不判断什么内容与投资任务相关。当前不虚构第二 Provider，现有独立 Provider 接口为后续接入保留位置。

## 5. 模型与基础设施解耦

Flash、Pro、Qwen 及未来模型只是 Research Agent 的可替换内核。Research Infrastructure 与模型品牌无关。普通任务可以使用成本较低的模型；深度研究未来可以选择更强模型和更高 Research Budget，而无需修改 Research Kernel。

## 6. Research Budget

当前预算由 `ResearchBudget` / `DEFAULT_RESEARCH_BUDGET` 统一描述，包括 turn、search call、query、read URL 和 duration 上限。现阶段保留既有默认值。

长期方向是以 time、token 和 cost budget 为主，由 AI 在预算内自主决定 search、read、backtrack 或 finish。预算只约束资源，不规定研究顺序。

## 7. Finalization 与发布边界

Agent 正常输出合法 ResearchReport 时直接发布到薄边界。若研究结论完整但最终 JSON/schema 损坏，Runtime 只进行一次 Final JSON Repair：输入原始最终输出、Report contract 和 allowed URLs，只修格式并保留原判断。仅当 repair 失败时，才使用基于 sources/evidence 的 forced finalization。

Publication Format Repair 与 Final JSON Repair 相互独立：前者只处理用户明确提出的长度等格式约束，后者只修复 Agent 已完成输出的 JSON/schema；两者都不得重新研究或新增事实。

## 8. 分阶段路线

### Phase 1

保持 AI-native kernel，修复研究上下文丢失，建立 Research Infrastructure 抽象。

### Phase 2

接入第二个独立 Web Search Provider，由 Search Router 实现多源召回。

### Phase 3

接入专业金融、公告和交易数据源，提供深度研究模式，并演进为动态时间/Token/成本预算。
