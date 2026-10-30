import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildDeepResearchQuantitativeAnalysis,
  quantitativeAnalysisPromptBlock,
} from "../src/lib/deepResearchQuantitative";
import { extractExcelFinancials } from "../src/lib/excelFinancials";
import type { FinancialData, FinPoint } from "../src/lib/types";

const point = (
  year: number,
  value: number,
  type: "actual" | "forecast",
  cell: string
): FinPoint => ({
  year,
  value,
  type,
  confidence: "high",
  source: { kind: "excel", locator: `SHEET:财务预测!${cell}` },
});

const financialData: FinancialData = {
  currency: "人民币",
  unit: "万元",
  extraction_quality: "high",
  extraction_note: "Excel直接读取",
  revenue: [
    point(2024, 1000, "actual", "B2"),
    point(2025, 1500, "actual", "C2"),
    point(2027, 3000, "forecast", "E2"),
  ],
  ebitda: [],
  ebit: [],
  net_income: [
    point(2024, -100, "actual", "B3"),
    point(2025, 100, "actual", "C3"),
  ],
  gross_margin: [point(2025, 0.6, "actual", "C4")],
  net_margin: [],
  headcount: [point(2027, 60, "forecast", "E5")],
  customers: [point(2027, 120, "forecast", "E6")],
  arr: [],
  mrr: [],
  cash: [point(2025, 600, "actual", "C7")],
  burn_rate: [point(2025, -100, "actual", "C8")],
  runway_months: [],
  valuation: [],
  key_metrics: [
    {
      label: "TAM 总可寻址市场",
      value: "100亿元",
      year: 2025,
      confidence: "high",
      note: "项目材料披露",
      source: { kind: "document", locator: "M1·P18" },
    },
  ],
};

const complete = buildDeepResearchQuantitativeAnalysis({
  financialData,
  decisionContext: `
拟投金额：1000万元
投前估值：4000万元
持有期：5年
悲观情景退出估值：5000万元
基准情景退出估值：1亿元
乐观情景退出估值：2亿元（来源：https://example.com/exit-case）
`,
});

assert.equal(complete.status, "ready");
assert.equal(complete.scenarios.every((scenario) => scenario.status === "computed"), true);
assert.equal(complete.scenarios[0].ownership, 0.2);
assert.equal(complete.scenarios[0].moic, 1);
assert.ok(Math.abs((complete.scenarios[1].irr ?? 0) - 0.148698) < 0.00001);
assert.equal(complete.scenarios[2].moic, 4);
assert.match(complete.scenarios[2].sourceRefs.join(" "), /https:\/\/example\.com\/exit-case/);
assert.match(
  complete.metrics.find((metric) => metric.id === "latest_actual_revenue_growth")?.displayValue ?? "",
  /50%/
);
assert.equal(
  complete.metrics.find((metric) => metric.id === "cash_runway")?.displayValue,
  "6个月"
);
assert.match(
  complete.metrics.find((metric) => metric.id === "break_even_year")?.displayValue ?? "",
  /2025年/
);
assert.match(
  complete.metrics.find((metric) => metric.id === "latest_actual_revenue_growth")?.sourceRefs.join(" ") ?? "",
  /SHEET:财务预测!B2/
);
assert.match(quantitativeAnalysisPromptBlock(complete), /MOIC 2x/);
assert.doesNotMatch(quantitativeAnalysisPromptBlock(complete), /停止测算/);

const blockedReturns = buildDeepResearchQuantitativeAnalysis({
  financialData,
  decisionContext: "拟投金额：1000万元",
});
assert.equal(blockedReturns.status, "partial");
assert.equal(blockedReturns.scenarios.every((scenario) => scenario.status === "blocked"), true);
assert.ok(blockedReturns.blockers.some((item) => item.includes("持有期")));
assert.ok(blockedReturns.blockers.some((item) => item.includes("退出估值")));
assert.match(quantitativeAnalysisPromptBlock(blockedReturns), /blocked 项不得补猜/);

const noInputs = buildDeepResearchQuantitativeAnalysis({});
assert.equal(noInputs.status, "blocked");
assert.ok(noInputs.blockers.some((item) => item.includes("结构化财务数据")));

const singleLine = buildDeepResearchQuantitativeAnalysis({
  financialData,
  decisionContext: "投前估值4000万元，拟投金额1000万元，持有期5年；悲观退出估值5000万元；基准退出估值1亿元；乐观退出估值2亿元",
});
assert.equal(singleLine.scenarios[1].investmentAmount, 10_000_000);
assert.equal(singleLine.scenarios[1].preMoneyValuation, 40_000_000);
assert.equal(singleLine.scenarios[1].holdingYears, 5);

const returnOnly = buildDeepResearchQuantitativeAnalysis({
  decisionContext: "拟投金额1000万元；投前估值4000万元；持有期5年；悲观退出估值5000万元；基准退出估值1亿元；乐观退出估值2亿元",
});
assert.equal(returnOnly.status, "partial");
assert.ok(returnOnly.blockers.some((item) => item.includes("结构化财务数据")));

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([
    ["指标", "2024年", "2025年"],
    ["营业收入", 100, 150],
    ["净利润", -20, 10],
  ]),
  "经营数据"
);
const extracted = extractExcelFinancials(
  XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
);
assert.equal(extracted?.revenue[0].source?.locator, "SHEET:经营数据!B2");
assert.equal(extracted?.revenue[1].source?.locator, "SHEET:经营数据!C2");

console.log("deep research quantitative tests passed");
