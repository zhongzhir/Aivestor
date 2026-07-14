import assert from "assert";
import { composeFormalReport } from "../src/lib/formal-report/composer";
import { FORMAL_REPORT_PROFILES } from "../src/lib/formal-report/profiles";

const metadata = {
  title: "中数创图项目分析",
  projectName: "中数创图",
  organizationName: "科融通",
  industry: "人工智能 / 文化科技",
  stage: "立项评审",
  reportDate: new Date("2026-07-14T00:00:00+08:00"),
  version: 2,
};

const source = `好的，作为资深投资专家，我将完成分析。

### **项目 SWOT 分析：中数创图**

**核心分析视角：** 公司提供文化数字化基础设施与运营服务，应重点验证单位经济模型。

#### **Strengths（优势）**

**1. 政策与先发优势**：已形成较深的公共文化机构合作基础。

#### **Weaknesses（劣势）**

**2. AI能力尚需验证**：现有材料不足以证明大模型已进入核心生产流程。

#### **Opportunities（机会）**

**3. 文化数据资产化机会**：政策与技术环境提供潜在增长空间。

#### **Threats（威胁）**

**4. 回款与财政周期风险**：政府客户采购周期可能影响现金流。

### **战略建议**

**应该做什么（核心聚焦）**：验证标杆项目和单位经济模型。
`;

const initiation = composeFormalReport({
  markdown: source,
  profile: FORMAL_REPORT_PROFILES.project_initiation,
  metadata,
});

assert.equal(initiation.applied, true);
assert.equal(initiation.profileKey, "project_initiation");
assert.match(initiation.markdown, /^# 执行摘要/m);
assert.match(initiation.markdown, /^# 项目概览/m);
assert.match(initiation.markdown, /^# 投资亮点与机会/m);
assert.match(initiation.markdown, /^# 核心风险与不确定性/m);
assert.match(initiation.markdown, /^# 初步判断与立项建议/m);
assert.match(initiation.markdown, /^# 待补充与核验事项/m);
assert.match(initiation.markdown, /商业模式与财务关注/);
assert.match(initiation.markdown, /尽调重点与待核验事项/);
assert.doesNotMatch(initiation.markdown, /好的，作为资深投资专家/);
assert.equal((initiation.markdown.match(/政策与先发优势/g) ?? []).length, 1);
assert.equal((initiation.markdown.match(/AI能力尚需验证/g) ?? []).length, 1);

const committee = composeFormalReport({
  markdown: "# 投资结论\n\n建议有条件通过。\n\n# 交易方案\n\n拟投资金额待确认。",
  profile: FORMAL_REPORT_PROFILES.investment_committee,
  metadata,
});
assert.match(committee.markdown, /^# 执行摘要与决策事项/m);
assert.match(committee.markdown, /^# 交易方案与核心条款/m);
assert.match(committee.markdown, /财务、估值与回报测算/);

const lp = composeFormalReport({
  markdown: "# 基金表现\n\n本期 DPI 为 0.3。\n\n# 投资组合\n\n组合公司经营总体稳定。",
  profile: FORMAL_REPORT_PROFILES.lp,
  metadata,
});
assert.match(lp.markdown, /^# 基金表现与收益指标/m);
assert.match(lp.markdown, /^# 投资组合进展/m);
assert.match(lp.markdown, /风险事项与披露/);

console.log("formal-report composer tests passed");
