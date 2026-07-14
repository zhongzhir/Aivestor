import assert from "assert";
import { writeFileSync } from "fs";
import JSZip from "jszip";
import { parseFormalReportMarkdown } from "../src/lib/formal-report/markdown";
import { buildFormalDocxBuffer } from "../src/lib/formal-report/docx";
import { FORMAL_REPORT_PROFILES } from "../src/lib/formal-report/profiles";
import { stripSourceBadges } from "../src/lib/reportBadges";

const markdown = `好的，作为资深的一级股权投资专家，我将严格遵循您的指令并完成分析。

### **项目 SWOT 分析：示例科技**

投资结论：建议进入下一轮尽调，但须核实收入真实性。

> 数据缺口：公司尚未提供完整审计报告。

#### **Strengths（优势）**

**1. 深度绑定的政策与先发优势**：已有明确项目验证。

**应该做什么（核心聚焦）**：

#### 核心指标

| 指标 | 2025年 | 2026年预测 |
| --- | ---: | ---: |
| 营收 | 1.2亿元 | 2.0亿元 |

1. 核实客户回款
2. 完成技术尽调

- 政策窗口明确
- 仍需验证商业化效率
`;

const blocks = parseFormalReportMarkdown(markdown);
assert.equal(blocks[0]?.type, "heading");
assert.equal(blocks[0]?.type === "heading" && blocks[0].level, 1);
assert.ok(
  !blocks.some(
    (block) => block.type === "paragraph" && block.text.startsWith("好的，")
  )
);
assert.ok(
  blocks.some(
    (block) =>
      block.type === "heading" &&
      block.level === 2 &&
      block.text.includes("Strengths")
  )
);
assert.ok(blocks.some((block) => block.type === "table"));
assert.ok(blocks.some((block) => block.type === "quote"));
assert.equal(
  blocks.filter((block) => block.type === "number").length,
  3
);
assert.ok(
  blocks.some(
    (block) => block.type === "number" && block.ordinal === "1"
  )
);
assert.equal(
  stripSourceBadges("事实[src:doc]，冲突[src:inconsistent]"),
  "事实，冲突"
);

async function main() {
  const buffer = await buildFormalDocxBuffer({
    profile: FORMAL_REPORT_PROFILES.investment_committee,
    metadata: {
      title: "示例项目投决会报告",
      projectName: "示例科技有限公司",
      organizationName: "示例基金",
      industry: "人工智能",
      stage: "B轮",
      reportDate: new Date("2026-07-14T00:00:00+08:00"),
      version: 2,
    },
    markdown,
  });

  assert.ok(buffer.length > 10_000, "formal docx should contain a complete package");

  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const headerXml = await zip.file("word/header1.xml")!.async("string");
  const footerXml = await zip.file("word/footer1.xml")!.async("string");
  const settingsXml = await zip.file("word/settings.xml")!.async("string");

  assert.match(documentXml, /示例科技有限公司/);
  assert.match(documentXml, /INVESTMENT DESK/);
  assert.match(documentXml, /投决会报告/);
  assert.match(documentXml, /投资结论/);
  assert.match(documentXml, /数据缺口/);
  assert.match(documentXml, /Strengths（优势）/);
  assert.match(documentXml, /w:tblHeader/);
  assert.doesNotMatch(documentXml, /好的，作为资深/);
  assert.doesNotMatch(documentXml, /\*\*/);
  assert.doesNotMatch(documentXml, /TOC .*\\o/);
  assert.match(headerXml, /示例科技有限公司/);
  assert.match(footerXml, /Aivestor/);
  assert.match(footerXml, /w:instrText[^>]*>PAGE/);
  assert.match(footerXml, /w:instrText[^>]*>SECTIONPAGES/);
  assert.match(settingsXml, /w:updateFields/);

  if (process.env.FORMAL_REPORT_SAMPLE_PATH) {
    writeFileSync(process.env.FORMAL_REPORT_SAMPLE_PATH, buffer);
  }

  console.log("formal-report tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
