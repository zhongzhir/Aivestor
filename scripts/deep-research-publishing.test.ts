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

登记信息可由示例监管机构存档交叉核验。【E1】[src:external]

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

进入条件：以主体、财务和客户三项P0通过作为进入谈判的前置条件。[src:ai]

投资方式：建议分期出资，并将第二期出资与产品测试和收入里程碑挂钩。[src:ai]

退出路径：优先核验产业并购、后续轮老股转让和回购安排的可执行性。[src:ai]

# 十四、风险提示与补充尽调清单

| 级别 | 类别 | 验证动作 |
| --- | --- | --- |
| P0 | 主体与股权 | 取得工商档案、股东名册和历史变更材料 |
| P0 | 财务与审计 | 取得审计报告、总账和纳税申报表 |
| P0 | 客户与收入 | 取得合同、发票、验收与回款流水 |
| P0 | 产品与技术 | 完成产品测试并留存测试报告 |
| P0 | 供应链与交付 | 核验BOM、认证、良率和量产交付记录 |
| P0 | 模型与数据 | 核验模型算法权属、训练数据来源和数据授权 |

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
  findingIds: ["E1"],
  topics: ["主体"],
  claims: ["登记信息可交叉核验"],
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
      reportDate: new Date("2026-10-29T00:00:00+08:00"),
      dataCutoffDate: new Date("2026-10-28T00:00:00+08:00"),
    },
    externalSources,
  });
  const pptxZip = await JSZip.loadAsync(pptx);
  const slideCount = Object.keys(pptxZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  assert.equal(slideCount, 14, "IC deck should stay within 15 slides");
  const valuationSlide = await pptxZip.file("ppt/slides/slide7.xml")!.async("string");
  assert.match(valuationSlide, /估值参数与敏感性/);
  assert.doesNotMatch(valuationSlide, /研究身份/);
  const coverSlide = await pptxZip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(coverSlide, /资料截止日：2026年10月28日/);
  assert.match(coverSlide, /出具日期：2026年10月29日/);
  const evidenceSlide = await pptxZip.file("ppt/slides/slide3.xml")!.async("string");
  assert.match(evidenceSlide, /来源标记出现次数/);
  assert.match(evidenceSlide, /非去重证据条数/);
  const p0Slide = await pptxZip.file("ppt/slides/slide11.xml")!.async("string");
  assert.match(p0Slide, /产品测试/);
  assert.match(p0Slide, /BOM/);
  assert.match(p0Slide, /模型算法权属/);
  assert.match(p0Slide, /数据授权/);
  const entryExitSlide = await pptxZip.file("ppt/slides/slide12.xml")!.async("string");
  assert.match(entryExitSlide, /进入条件/);
  assert.match(entryExitSlide, /分期出资/);
  assert.match(entryExitSlide, /退出路径/);
  const actionSlide = await pptxZip.file("ppt/slides/slide13.xml")!.async("string");
  assert.match(actionSlide, /责任人、完成时点、交付材料和复核结论/);
  assert.match(actionSlide, /决策触发/);
  assert.doesNotMatch(actionSlide, /建议暂缓，先补齐客户回款与主体证明/);
  const endSlide = await pptxZip.file("ppt/slides/slide14.xml")!.async("string");
  assert.match(endSlide, /建议暂缓，先补齐客户回款与主体证明/);
  const slideXml = await Promise.all(
    Object.keys(pptxZip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map((name) => pptxZip.file(name)!.async("string"))
  );
  assert.doesNotMatch(slideXml.join("\n"), /…/, "IC deck must not hard-truncate claims with ellipses");
  const notes = await Promise.all(
    Object.keys(pptxZip.files)
      .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
      .map((name) => pptxZip.file(name)!.async("string"))
  );
  assert.match(notes.join("\n"), /https:\/\/example\.gov\.cn\/company\/1/);
  assert.match(notes.join("\n"), /https:\/\/archive\.example\.gov\.cn\/company\/1/);
  const contentNotes = notes.filter((note) => /本页溯源（审核稿）/.test(note));
  assert.equal(contentNotes.length, 12, "all IC content slides should carry page-level trace notes");
  const notesWithArchiveSource = contentNotes.filter((note) => /https:\/\/archive\.example\.gov\.cn\/company\/1/.test(note));
  assert.equal(notesWithArchiveSource.length, 2, "external source should appear only on evidence and mapped finding slides");
  assert.ok(new Set(contentNotes).size >= 3, "page-level notes must not repeat one identical global URL list");
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
