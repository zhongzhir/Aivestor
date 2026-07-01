import assert from "assert";
import {
  buildCreatedInstitutionMetadata,
  buildFeatureChunks,
  parseInstitutionName,
  parseWordMlText,
  planInputZips,
} from "../import-gp-detail-docs";

function testParseInstitutionName() {
  const parsed = parseInstitutionName(
    "GP详情（上海虹口）/财盈咨华私募基金管理（上海）有限公司20260630171343尽调报告.doc"
  );
  assert.equal(parsed.institutionName, "财盈咨华私募基金管理（上海）有限公司");
  assert.equal(parsed.reportDate, "2026-06-30");
}

function testParseWordMlText() {
  const xml = `<?xml version="1.0"?><w:wordDocument xmlns:w="x"><w:body><w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>内容</w:t></w:r></w:p><w:p><w:r><w:t>第二段&amp;符号</w:t></w:r></w:p></w:body></w:wordDocument>`;
  assert.equal(parseWordMlText(xml), "第一段 内容\n第二段&符号");
}

function testBuildFeatureChunks() {
  const text = "甲".repeat(120) + "乙".repeat(120) + "丙".repeat(120);
  const chunks = buildFeatureChunks(
    {
      fileName: "样本20260630120000尽调报告.doc",
      institutionName: "样本资本",
      reportDate: "2026-06-30",
      region: "上海",
      sourceBatch: "GP详情-测试",
      text,
      hash: "hash-1",
    },
    {
      chunkSize: 180,
      chunkOverlap: 20,
      maxChunksPerReport: 3,
    }
  );
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].content.includes("【GP尽调报告】"));
  assert.ok(chunks[0].content.includes("机构：样本资本"));
  assert.equal(chunks[1].metadata.chunk_index, 2);
  assert.equal(chunks[1].metadata.total_chunks, 3);
  assert.equal(chunks[1].metadata.source_kind, "gp_due_diligence_report");
}

function testPlanInputZips() {
  const planned = planInputZips([
    "C:/data/GP详情（上海虹口）.zip",
    "C:/data/其他.zip",
  ]);
  assert.deepEqual(planned.found.map((x) => x.region), ["上海"]);
  assert.ok(planned.missing.some((x) => x.includes("杭州")));
}

function main() {
  testParseInstitutionName();
  testParseWordMlText();
  testBuildFeatureChunks();
  testPlanInputZips();
  assert.deepEqual(buildCreatedInstitutionMetadata("GP-detail-test"), {
    created_from: "gp_detail_doc_import",
    source_batch: "GP-detail-test",
    needs_review: true,
  });
  console.log("import-gp-detail-docs tests passed");
}

main();
