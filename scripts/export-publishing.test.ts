import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBrandConfig } from "@/lib/brand";
import { buildFormalDocxBuffer } from "@/lib/formal-report/docx";
import { buildPptReportBuffer, parsePptSections } from "@/lib/ppt-report";
import { FORMAL_REPORT_PROFILES } from "@/lib/formal-report/profiles";

const samples = [
  {
    name: "ordinary-project-analysis",
    markdown: `# 项目概览
项目是一家面向企业客户的产业服务平台，处于早期阶段，当前材料已完成初步整理。

# 市场机会分析
目标市场仍处于结构化升级阶段，需求来自多个明确的业务场景。

# 团队评估
- 团队具备行业经验
- 关键岗位仍需补充

# 风险提示
需要进一步核验客户集中度、合同稳定性和现金流安全边际。

# 初步结论
建议在补充关键材料后继续观察。`,
  },
  {
    name: "investment-committee",
    markdown: `## 执行摘要
本项目具备一定产业价值，但关键假设尚未充分验证。

## 项目概况
项目围绕企业服务场景提供标准化产品。

### 核心判断
团队执行力是当前最重要的跟踪变量。

## 投资建议
- 建议有条件推进
- 优先完成客户与财务核验
`,
  },
  {
    name: "lp-report",
    markdown: `## 本期概览
本期组合整体运行平稳，部分项目进入关键经营节点。

## 项目进展
### 项目 A
收入和客户数量保持增长，但退出路径仍需持续观察。

## 风险与后续安排
- 跟踪重大经营事项
- 完善季度数据回收机制`,
  },
  {
    name: "table-heavy",
    markdown: `# 财务与经营数据
以下表格汇总主要经营指标，数据截止日期以项目材料为准。

| 指标 | 2023 | 2024 | 2025 | 备注 |
| --- | --- | --- | --- | --- |
| 收入 | 100 | 180 | 260 | 保持增长 |
| 毛利率 | 42% | 45% | 47% | 需核验口径 |
| 客户数 | 20 | 36 | 58 | 客户集中度待查 |
| 现金储备 | 800 | 620 | 510 | 单位万元 |
| 研发人员 | 12 | 18 | 25 | 核心岗位稳定 |
| 合同续约率 | 70% | 76% | 81% | 样本仍有限 |`,
  },
  {
    name: "long-form",
    markdown: `# 风险分析
## 商业模式风险
${"项目当前商业模式仍处于验证阶段，收入增长、客户留存、交付效率和现金回收之间存在相互影响的关系。".repeat(12)}

### 需要持续验证的假设
1. 客户愿意持续付费并扩大使用范围
2. 交付团队可以在规模增长后保持服务质量
3. 新增客户成本不会显著侵蚀毛利

## 后续行动
- 补充客户合同和回款数据
- 核对财务模型与 BP 正文口径
- 在下一轮会议中复盘关键风险`,
  },
];

const outputDir = path.resolve(process.cwd(), "artifacts", "export-acceptance");
fs.mkdirSync(outputDir, { recursive: true });
const date = new Date("2026-08-03T00:00:00+08:00");

async function main() {
  for (const sample of samples) {
    const sections = parsePptSections(sample.markdown);
    assert.ok(sections.length > 0, `${sample.name} should have sections`);
    assert.ok(
      sections.every((section) => section.blocks.length > 0),
      `${sample.name} should not create empty sections`
    );
    const ppt = await buildPptReportBuffer({
      markdown: sample.markdown,
      brand: getBrandConfig("aivestor"),
      metadata: {
        title: sample.name,
        projectName: `验收项目 · ${sample.name}`,
        industry: "企业服务",
        stage: "早期",
        reportDate: date,
      },
    });
    fs.writeFileSync(path.join(outputDir, `aivestor-${sample.name}.pptx`), ppt);
  }

  const committee = samples[1];
  const zhongjianPpt = await buildPptReportBuffer({
    markdown: committee.markdown,
    brand: getBrandConfig("zhongjian-zhitou"),
    metadata: {
      title: committee.name,
      projectName: `验收项目 · ${committee.name}`,
      industry: "企业服务",
      stage: "早期",
      reportDate: date,
    },
  });
  fs.writeFileSync(
    path.join(outputDir, "zhongjian-zhitou-investment-committee.pptx"),
    zhongjianPpt
  );

  const ordinary = samples[0];
  const lp = samples[2];
  const tableHeavy = samples[3];
  const longForm = samples[4];
  for (const [brandName, sample, profile] of [
    ["aivestor", ordinary, FORMAL_REPORT_PROFILES.project_initiation],
    ["zhongjian-zhitou", lp, FORMAL_REPORT_PROFILES.lp],
    ["aivestor", tableHeavy, FORMAL_REPORT_PROFILES.project_initiation],
    ["zhongjian-zhitou", longForm, FORMAL_REPORT_PROFILES.project_initiation],
  ] as const) {
    const docx = await buildFormalDocxBuffer({
      brand: getBrandConfig(brandName),
      profile,
      metadata: {
        title: sample.name,
        projectName: `验收项目 · ${sample.name}`,
        organizationName: brandName === "zhongjian-zhitou" ? "中鉴智投" : "Aivestor",
        industry: "企业服务",
        stage: "早期",
        reportDate: date,
      },
      markdown: sample.markdown,
    });
    fs.writeFileSync(path.join(outputDir, `${brandName}-${sample.name}.docx`), docx);
  }

  console.log(`export publishing tests passed: ${samples.length + 1} PPT + 4 Word files in ${outputDir}`);
}

void main();
