import assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCreatedInstitutionMetadata,
  buildFeatureChunks,
  collectDryRun,
  computeFileHash,
  parseInstitutionName,
  parseWordMlText,
  planInputSources,
  planInputZips,
  readExtractedReportDoc,
} from "../import-gp-detail-docs";

const REPORT_SUFFIX = "\u5c3d\u8c03\u62a5\u544a";

function testParseInstitutionName() {
  const parsed = parseInstitutionName(`Sample Capital20260630171343${REPORT_SUFFIX}.doc`);
  assert.equal(parsed.institutionName, "Sample Capital");
  assert.equal(parsed.reportDate, "2026-06-30");
}

function testParseWordMlText() {
  const xml = `<?xml version="1.0"?><w:wordDocument xmlns:w="x"><w:body><w:p><w:r><w:t>first</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>line</w:t></w:r></w:p><w:p><w:r><w:t>second&amp;line</w:t></w:r></w:p></w:body></w:wordDocument>`;
  assert.equal(parseWordMlText(xml), "first line\nsecond&line");
}

function testBuildFeatureChunks() {
  const text = "a".repeat(120) + "b".repeat(120) + "c".repeat(120);
  const chunks = buildFeatureChunks(
    {
      fileName: `Sample20260630120000${REPORT_SUFFIX}.doc`,
      institutionName: "Sample Capital",
      reportDate: "2026-06-30",
      region: "\u4e0a\u6d77",
      sourceBatch: "GP-detail-test",
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
  assert.ok(chunks[0].content.includes("\u3010GP\u5c3d\u8c03\u62a5\u544a\u3011"));
  assert.ok(chunks[0].content.includes("Sample Capital"));
  assert.equal(chunks[1].metadata.chunk_index, 2);
  assert.equal(chunks[1].metadata.total_chunks, 3);
  assert.equal(chunks[1].metadata.source_kind, "gp_due_diligence_report");
}

function testPlanInputZips() {
  const planned = planInputZips([
    "C:/data/GP\u8be6\u60c5\uff08\u4e0a\u6d77\u8679\u53e3\uff09.zip",
    "C:/data/other.zip",
  ]);
  assert.deepEqual(planned.found.map((x) => x.region), ["\u4e0a\u6d77"]);
  assert.ok(planned.missing.some((x) => x.includes("\u676d\u5dde")));
}

async function testExtractedDirectoryScanAndParse() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zjjr-gp-extracted-"));
  const nested = path.join(root, "GP-details");
  fs.mkdirSync(nested);
  const file = path.join(nested, `Sample Capital20260630120000${REPORT_SUFFIX}.doc`);
  const xml = `<?xml version="1.0"?><w:wordDocument xmlns:w="x"><w:body><w:p><w:r><w:t>hello GP</w:t></w:r></w:p></w:body></w:wordDocument>`;
  fs.writeFileSync(file, xml, "utf8");

  const planned = planInputSources([file], {
    input: root,
    mode: "extracted",
    batchName: "GP-detail-extracted-test",
  });
  assert.equal(planned.kind, "extracted");
  assert.deepEqual(planned.extractedFiles, [file]);

  const report = readExtractedReportDoc(file, {
    inputRoot: root,
    region: null,
    sourceBatch: "GP-detail-extracted-test",
  });
  assert.equal(report.institutionName, "Sample Capital");
  assert.equal(report.reportDate, "2026-06-30");
  assert.equal(report.text, "hello GP");

  const dryRun = await collectDryRun({
    input: root,
    mode: "extracted",
    batchName: "GP-detail-extracted-test",
    limit: null,
  });
  assert.equal(dryRun.stats.reportCount, 1);
  assert.equal(dryRun.stats.parsedCount, 1);
  assert.equal(dryRun.samples.length, 1);
  assert.ok(!("text" in dryRun.samples[0]));
}

function testFileHashIsStable() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zjjr-gp-hash-"));
  const file = path.join(root, "hash-sample.xml");
  fs.writeFileSync(file, "<?xml version=\"1.0\"?><w:wordDocument />", "utf8");
  assert.equal(computeFileHash(file), computeFileHash(file));
}

function testDoesNotWritePrivateKnowledgeTables() {
  const source = fs.readFileSync(path.resolve(__dirname, "../import-gp-detail-docs.ts"), "utf8");
  assert.ok(!/INSERT\s+INTO\s+knowledge_base_entries/i.test(source));
  assert.ok(!/\borg_id\b/.test(source));
  assert.ok(!/\bvisibility\b/.test(source));
}

async function main() {
  testParseInstitutionName();
  testParseWordMlText();
  testBuildFeatureChunks();
  testPlanInputZips();
  assert.deepEqual(buildCreatedInstitutionMetadata("GP-detail-test"), {
    created_from: "gp_detail_doc_import",
    source_batch: "GP-detail-test",
    needs_review: true,
  });
  testFileHashIsStable();
  testDoesNotWritePrivateKnowledgeTables();
  await testExtractedDirectoryScanAndParse();
  console.log("import-gp-detail-docs tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
