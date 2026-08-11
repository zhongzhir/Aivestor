import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BRAND_CONFIGS } from "@/lib/brand";

const aivestor = BRAND_CONFIGS.aivestor;
const zhongjian = BRAND_CONFIGS["zhongjian-zhitou"];

assert.equal(aivestor.legalName, "北京链上文投信息技术有限公司");
assert.equal(aivestor.compliance.icpFiling, "京ICP备2026011107号-3");
assert.deepEqual(aivestor.compliance.publicSecurityFiling, {
  number: "京公网安备11010802048729号",
  href: "https://beian.mps.gov.cn/#/query/webSearch?code=11010802048729",
});

assert.equal(zhongjian.legalName, "中鉴智投（杭州）智能科技有限公司");
assert.equal(zhongjian.compliance.icpFiling, "浙ICP备2026062282号-1");
assert.equal(zhongjian.compliance.publicSecurityFiling, null);

const footer = fs.readFileSync(
  path.join(process.cwd(), "src/components/Footer.tsx"),
  "utf8"
);

assert.match(footer, /BRAND\.compliance\.icpFiling/);
assert.match(footer, /publicSecurityFiling \?/);
assert.doesNotMatch(footer, /BRAND\.profile|zhongjian-zhitou|京ICP备|浙ICP备|京公网安备/);

console.log("brand compliance tests passed");
