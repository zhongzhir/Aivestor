import assert from "node:assert/strict";
import {
  buildGenerationMessages,
  REPORT_CONTEXT_DOC_KINDS,
} from "../src/lib/report";
import { serializeExcelFinancialDataForProject } from "../src/lib/excelFinancials";
import type { FinancialData } from "../src/lib/types";

assert.ok(
  REPORT_CONTEXT_DOC_KINDS.includes("financial_model"),
  "report context should include uploaded financial model documents"
);

const emptyFinancial: FinancialData = {
  currency: "",
  unit: "",
  extraction_quality: "high",
  extraction_note: "",
  revenue: [],
  ebitda: [],
  ebit: [],
  net_income: [],
  gross_margin: [],
  net_margin: [],
  headcount: [],
  customers: [],
  arr: [],
  mrr: [],
  cash: [],
  burn_rate: [],
  runway_months: [],
  valuation: [],
  key_metrics: [],
};

assert.equal(
  serializeExcelFinancialDataForProject(null),
  null,
  "failed Excel financial extraction should clear stale project financial data"
);

assert.equal(
  serializeExcelFinancialDataForProject(emptyFinancial),
  JSON.stringify(emptyFinancial),
  "successful Excel financial extraction should be persisted"
);

const { messages } = buildGenerationMessages({
  projectName: "示例项目",
  bpText: "财务报表-2026年5期月报：2026年收入 1.18 亿",
  judgmentPoints: ["关注收入", "关注现金流", "关注存货"],
  financialData: null,
});

const userPrompt = messages[0].content;
assert.match(
  userPrompt,
  /不得沿用系统提示中的示例年份/,
  "report prompt should forbid reusing example/default years"
);
assert.match(
  userPrompt,
  /2026年收入 1\.18 亿/,
  "report prompt should preserve the uploaded 2026 financial text"
);

console.log("report-financial-context tests passed");
