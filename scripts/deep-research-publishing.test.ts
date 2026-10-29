import assert from "assert";
import JSZip from "jszip";
import { parseFormalReportMarkdown } from "../src/lib/formal-report/markdown";
import { buildFormalDocxBuffer } from "../src/lib/formal-report/docx";
import { FORMAL_REPORT_PROFILES } from "../src/lib/formal-report/profiles";
import { buildPptReportBuffer } from "../src/lib/ppt-report";
import { BRAND } from "../src/lib/brand";

const markdown = `# 研究身份与边界

当前为AI生成审核稿，已运行项目级外部检索和正文读取。

# 执行摘要

建议暂缓，先补齐客户回款与主体证明。【M1·P6】[src:doc]

# 二、公司概览

公司口径称已形成产品矩阵。【M1·P8】[src:doc]

# 三、核心产品、技术与业务架构

技术能力仍待独立测试。[src:gap]

# 四、客户、市场与商业化能力

收入确认链条尚未闭合。[src:gap]

# 五、核心团队深度分析

核心人员履历需交叉核验。[src:gap]

# 六、发展阶段与财务分析

| 指标 | 2025A | 2026E |
| --- | ---: | ---: |
| 收入 | 1600 | 1400 |
| 硬件毛利率 | 75% | <30%情景需复核 |

# 七、竞争对手深度对比

现有材料未形成同口径竞争比较。[src:gap]

# 十、核心瓶颈与风险缓释

已确认负面事实、证据缺口和建议验证阈值应分列。

# 十一、融资历史与机构分析

估值口径存在冲突。[src:inconsistent]

# 十二、投资价值与适配度

进入方式应与里程碑挂钩。[src:ai]

# 十四、风险提示与补充尽调清单

P0：取得合同、发票、验收与回款流水。

# 十五、数据来源与证据分级

- 【E-S1】[示例监管机构｜主体登记](https://example.gov.cn/company/1)｜发布/更新：2026-10-20｜支持主张：主体登记

# 十六、重要声明与数据缺口

当前缺少审计报告。
`;

const externalSources = [{
  id: "E-S1",
  title: "主体登记存档",
  url: "https://archive.example.gov.cn/company/1",
  publisher: "示例监管机构",
  domain: "example.gov.cn",
  publishedAt: "2026-10-20",
  sourceTier: "S",
  evidenceStatus: "full",
}];

async function main() {
  const blocks = parseFormalReportMarkdown(markdown);
  const financialTable = blocks.find((block) => block.type === "table");
  assert.ok(financialTable && financialTable.type === "table");
  assert.equal(financialTable.rows[2][2], "<30%情景需复核");

  const docx = await buildFormalDocxBuffer({
    profile: FORMAL_REPORT_PROFILES.deep_research,
    metadata: {
      title: "示例项目深度投研报告",
      projectName: "示例项目",
      reportDate: new Date("2026-10-28T00:00:00+08:00"),
      version: 1,
    },
    markdown,
    externalSources,
  });
  const docxZip = await JSZip.loadAsync(docx);
  const documentXml = await docxZip.file("word/document.xml")!.async("string");
  const relsXml = await docxZip.file("word/_rels/document.xml.rels")!.async("string");
  assert.match(documentXml, /&lt;30%情景需复核/);
  assert.match(documentXml, /AI生成审核稿/);
  assert.match(relsXml, /https:\/\/example\.gov\.cn\/company\/1/);
  assert.match(relsXml, /https:\/\/archive\.example\.gov\.cn\/company\/1/);
  assert.doesNotMatch(documentXml, /文档说明/);

  const pptx = await buildPptReportBuffer({
    markdown,
    brand: BRAND,
    mode: "deep_research_ic",
    financialData: {
      currency: "CNY",
      unit: "万元",
      extraction_quality: "medium",
      extraction_note: "测试",
      revenue: [
        { year: 2025, value: 1600, type: "actual", confidence: "high" },
        { year: 2026, value: 1400, type: "forecast", confidence: "low" },
      ],
      ebitda: [], ebit: [], net_income: [], gross_margin: [], net_margin: [],
      headcount: [], customers: [], arr: [], mrr: [], cash: [], burn_rate: [],
      runway_months: [], valuation: [], key_metrics: [],
    },
    metadata: {
      title: "示例项目深度投研报告",
      projectName: "示例项目",
      industry: "企业服务",
      stage: "成长期",
      reportDate: new Date("2026-10-28T00:00:00+08:00"),
    },
    externalSources,
  });
  const pptxZip = await JSZip.loadAsync(pptx);
  const slideCount = Object.keys(pptxZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  assert.equal(slideCount, 14, "IC deck should stay within 15 slides");
  const valuationSlide = await pptxZip.file("ppt/slides/slide7.xml")!.async("string");
  assert.match(valuationSlide, /估值参数与敏感性/);
  assert.doesNotMatch(valuationSlide, /研究身份/);
  const notes = await Promise.all(
    Object.keys(pptxZip.files)
      .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
      .map((name) => pptxZip.file(name)!.async("string"))
  );
  assert.match(notes.join("\n"), /https:\/\/example\.gov\.cn\/company\/1/);
  assert.match(notes.join("\n"), /https:\/\/archive\.example\.gov\.cn\/company\/1/);
  const notesWithSources = notes.filter((note) => /https:\/\//.test(note));
  assert.equal(notesWithSources.length, 12, "all IC content slides should carry source notes");
  const contentTypes = await pptxZip.file("[Content_Types].xml")!.async("string");
  const missingTargets = Array.from(
    contentTypes.matchAll(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g),
    (match) => match[1]
  ).filter((part) => !pptxZip.file(part));
  assert.deepEqual(missingTargets, [], "PPTX content types must not reference missing parts");

  console.log("deep research publishing tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
