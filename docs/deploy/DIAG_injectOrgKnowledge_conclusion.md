# 诊断结论：injectOrgKnowledge 未注入的根因与修复

> 日期：2026-06-12
> 方法：临时诊断日志 → 人工在生产触发简要分析 → 看日志 → 定位 → 修复 + 移除日志

## 一、诊断结论（情况 B：检索从未触发）

生产日志（简要分析触发）：

```
[orgInject][diag] called org=69feed93-... role=admin org_knowledge=true queryLen=4 query="大美非遗"
[orgInject][diag] query too short (len=4 < 10), skip retrieval. query="大美非遗"
[orgInject][diag] retrieval empty → no section, return original
[brief-analysis][diag] injectOrgKnowledge query="大美非遗" systemLen 275 -> 275 (delta=0)
（另一例：query="喷空" len=2，同样被跳过）
```

逐项确认：
- **接入正常**（不是情况 A）：`injectOrgKnowledge` 确被 `brief-analysis` 调用。
- **能力位正常**：`org_knowledge=true`。
- **根因**：检索 query = `项目名 + 行业 + 阶段` 拼接，而被测项目的「行业/阶段」为空，query 退化为**纯项目名**（"大美非遗"=4 字、"喷空"=2 字）。`orgInject.ts` 的 `MIN_QUERY_LEN=10` 门槛（从 `memoryContext` 抄来、本意是过滤「继续」「展开」这类对话噪声）**把合法的中文短项目名一并误杀**，检索在进库前就被 `return []` 跳过——所以"## 机构知识沉淀"段从未生成（`delta=0`）。

这不是"注入了但 AI 没引用"（情况 C），而是**注入链路在检索门槛处被短路**，属可修复的代码缺陷。

## 二、修复

`src/lib/orgInject.ts`：`MIN_QUERY_LEN` 由 `10` 改为 `2`。

理由：`injectOrgKnowledge` 的 query 是**项目描述符**（项目名/报告标题等），不是对话消息，不存在「继续」这类噪声；只需排除空/单字符的退化 query。中文项目名常仅 2–4 字、且行业/阶段可能未填，10 字门槛会导致机构知识检索对这类项目**永不触发**。该门槛为 orgInject 全部接入路由（brief-analysis / reports / skills-run / merge）共用，一处修复全部生效。

> 说明：机构层检索**无相似度阈值**，命中候选（有 embedding 的 org 条目）即注入。所以修复后，只要 query ≥2 字且 org 层有带 embedding 的晋升条目，"## 机构知识沉淀"段就会生成。AI 是否在最终输出里引用，取决于该条目与当前项目的相关性（弱相关时不引用属正常）。

诊断日志已全部移除（`grep diag` 无残留），代码恢复整洁。`npm run build` 通过。

## 三、修复后人工复验步骤

1. 部署：`git pull && npm run build && pm2 restart all`
2. 在任一**已转入组织**的项目（如"大美非遗"）触发「简要分析」。预期：机构知识检索此时会真正执行（query ≥2 字即过门槛）。
3. **更有说服力的端到端验证**（证明对"相关"知识有效）：用 admin 账号晋升一条与被测项目**同赛道、内容具体**的知识，例如对"大美非遗/内容文化类"项目：
   > 「文化/非遗内容类项目尽调要点：重点核查 IP 与非遗技艺的授权链条是否清晰、内容是否依赖少数传承人（关键人风险）、以及线上内容的版权与审核合规。」
   再次触发简要分析，预期报告会体现/引用该机构沉淀（带【机构沉淀·作者名】来源）。

   选用相关内容的原因：之前晋升的是"我的测试""测试知识库。"等无实质语义的短文本，即便注入也与项目无关、AI 不会引用——无法证明链路有效。
