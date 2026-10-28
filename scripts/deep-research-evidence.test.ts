import assert from "assert";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { parseFile } from "../src/lib/fileParser";
import { chunkLocatedText } from "../src/lib/chunking";
import { buildDeepResearchMaterialContext } from "../src/lib/deepResearch";
import {
  assessDeepResearchReport,
  extractEvidenceLedger,
} from "../src/lib/deepResearchWorkpaper";

async function main() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["指标", "2025A", "2026E"],
      ["收入", 100, 180],
    ]),
    "财务预测"
  );
  const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const excel = await parseFile(excelBuffer, "xlsx", "财务模型.xlsx");
  assert.equal(excel.sourceMap.length, 1);
  assert.equal(excel.sourceMap[0].locator, "SHEET:财务预测!A1:C2");
  assert.match(excel.sourceMap[0].text, /B2=100/);
  assert.match(excel.text, /定位:SHEET:财务预测!A1:C2/);

  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="p" xmlns:a="a"><a:t>市场规模</a:t><a:t>100亿元</a:t></p:sld>'
  );
  zip.file(
    "ppt/slides/slide2.xml",
    '<p:sld xmlns:p="p" xmlns:a="a"><a:t>客户验证</a:t><a:t>试点中</a:t></p:sld>'
  );
  const ppt = await parseFile(await zip.generateAsync({ type: "nodebuffer" }), "pptx", "路演.pptx");
  assert.deepEqual(ppt.sourceMap.map((entry) => entry.locator), ["SLIDE1", "SLIDE2"]);
  assert.match(ppt.text, /幻灯片2/);

  const chunks = chunkLocatedText(excel.sourceMap);
  assert.ok(chunks.length > 0);
  assert.equal(chunks[0].metadata.locator, "SHEET:财务预测!A1:C2");

  const materialContext = buildDeepResearchMaterialContext([
    {
      filename: "财务模型.xlsx",
      docKind: "financial_model",
      extractedText: excel.text,
      sourceMap: excel.sourceMap,
    },
  ]);
  assert.match(materialContext, /【M1·SHEET:财务预测!A1:C2】/);
  assert.match(materialContext, /可回放定位：1处/);

  const headings = [
    "# 执行摘要与建议等级",
    "# 一、政策",
    "# 二、市场",
    "# 三、团队",
    "# 四、上下游目标",
    "# 五、客户定位",
    "# 六、初创投入",
    "# 七、商业模型",
    "# 综合研判、前置条件与触发器",
    "# 分级尽调清单",
    "# 来源索引与数字口径",
  ].join("\n\n内容【M1·SHEET:财务预测!A1:C2】[src:data]\n\n");
  const report = `${headings}\n\n[EVIDENCE_LEDGER_START]\n${JSON.stringify({
    items: [
      {
        id: "C1",
        claim: "收入预计增长80%",
        status: "data",
        citations: ["M1·SHEET:财务预测!A1:C2"],
        investmentImpact: "影响估值与投资时点",
        verificationAction: "核验订单和回款",
        priority: "P0",
      },
    ],
  })}\n[EVIDENCE_LEDGER_END]\n[CONFIDENCE_START]\n{"overall":"中","dimensions":[],"uncertainty":"待核验"}\n[CONFIDENCE_END]`;
  const extracted = extractEvidenceLedger(report);
  assert.equal(extracted.items.length, 1);
  assert.doesNotMatch(extracted.cleanContent, /EVIDENCE_LEDGER_START/);
  const assessed = assessDeepResearchReport({
    content: report,
    profile: "early_stage",
    validCitations: ["M1·SHEET:财务预测!A1:C2"],
  });
  assert.equal(assessed.gate.status, "pass");
  assert.equal(assessed.gate.sectionCoverageRate, 1);
  assert.equal(assessed.gate.locatedEvidenceRate, 1);

  const invalid = assessDeepResearchReport({
    content: report.replaceAll("M1·SHEET:财务预测!A1:C2", "M1·P99"),
    profile: "early_stage",
    validCitations: ["M1·SHEET:财务预测!A1:C2"],
  });
  assert.equal(invalid.gate.status, "review");
  assert.deepEqual(invalid.gate.invalidCitations, ["M1·P99"]);

  console.log("deep research evidence tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
