import assert from "assert";
import {
  buildDeepResearchMaterialContext,
  buildDeepResearchMessages,
  resolveDeepResearchProfile,
} from "../src/lib/deepResearch";

assert.equal(resolveDeepResearchProfile("auto", "天使轮"), "early_stage");
assert.equal(resolveDeepResearchProfile("auto", "Pre-A"), "early_stage");
assert.equal(resolveDeepResearchProfile("auto", "B轮"), "early_stage");
assert.equal(resolveDeepResearchProfile("auto", "C轮"), "comprehensive");
assert.equal(
  resolveDeepResearchProfile("comprehensive", "天使轮"),
  "comprehensive"
);

const materials = [
  {
    filename: "商业计划书.pdf",
    docKind: "bp",
    extractedText: "公司称已经获得三家头部客户试点。",
  },
  {
    filename: "财务模型.xlsx",
    docKind: "financial_model",
    extractedText: "2026E收入,3000,万元",
    sourceMap: [
      {
        locator: "SHEET:预测!A1:C2",
        locatorType: "sheet_range" as const,
        label: "工作表预测 A1:C2",
        sheet: "预测",
        range: "A1:C2",
        text: "A1=指标 | B1=2026E\nA2=收入 | B2=3000",
      },
    ],
  },
];
const materialContext = buildDeepResearchMaterialContext(materials);
assert.match(materialContext, /【M1】商业计划书\.pdf/);
assert.match(materialContext, /【M2】财务模型\.xlsx/);
assert.match(materialContext, /【M2·SHEET:预测!A1:C2】/);
assert.match(materialContext, /未经独立外部核验/);

const early = buildDeepResearchMessages({
  projectName: "示例项目",
  companyName: "示例科技有限公司",
  industry: "企业服务",
  stage: "A轮",
  requestedProfile: "auto",
  judgmentPoints: ["客户是否真实付费", "现金跑道是否覆盖下一里程碑"],
  decisionContext: "拟投资2000万元，持有期5年",
  sourceCutoffDate: "2026-10-26",
  materials,
});
assert.equal(early.resolvedProfile, "early_stage");
assert.match(early.system, /# 一、政策/);
assert.match(early.system, /# 七、商业模型/);
assert.match(early.system, /\[src:external\]/);
assert.match(early.messages[0].content, /资料截止日：2026-10-26/);
assert.match(early.messages[0].content, /拟投资2000万元/);
assert.match(early.messages[0].content, /【M2】财务模型\.xlsx/);

const comprehensive = buildDeepResearchMessages({
  projectName: "成长项目",
  stage: "D轮",
  requestedProfile: "auto",
  materials,
});
assert.equal(comprehensive.resolvedProfile, "comprehensive");
assert.match(comprehensive.system, /# 一、综合评级/);
assert.match(comprehensive.system, /# 十六、重要声明与数据缺口/);
assert.match(comprehensive.messages[0].content, /提炼5-10条项目特异性/);

console.log("deep research report tests passed");
