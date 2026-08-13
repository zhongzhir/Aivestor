import assert from "node:assert/strict";
import { classifyEmptyResult, reconcileIntegratedPublication, type ResearchClaim } from "@/lib/intelligenceResearchAgent";

const start = new Date("2026-08-01T00:00:00Z");
const end = new Date("2026-08-31T23:59:59Z");

function claim(id: string, url: string): ResearchClaim {
  return { id, statement: `${id} 完成一项资本事项`, eventDate: "2026-08-08T00:00:00.000Z", backgroundDate: null, entities: [id], eventType: "资本事项", significance: "补充发展资金", confidence: "high", sourceUrls: [url], evidenceStatus: "full", classification: "clue", relevanceToResearch: "medium", supportingEvidence: [] };
}

function integrated(id: string, url: string, extra: Record<string, unknown> = {}): any {
  return { id, statement: `${id} 完成一项资本事项`, eventDate: "2026-08-08", entities: [id], eventType: "资本事项", significance: "补充发展资金", confidence: "high", classification: "fact", relevanceToResearch: "high", supportingEvidence: [{ url, relevantText: `${id} 正文确认资本事项。`, publishedAt: "2026-08-08" }], ...extra };
}

function evidence(url: string, content: string) {
  return new Map([[url, { title: "正文", sourceUrl: url, content, evidenceStatus: "full" as const, evidencePublishedAt: "2026-08-08" }]]);
}

const sources = (urls: string[]) => urls.map((url) => ({ title: "来源", url, siteName: "来源", snippet: "正文确认", publishedAt: "2026-08-08", sourceTier: "B" as const, domain: new URL(url).hostname, query: "test" }));

{
  const urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  const result = reconcileIntegratedPublication(urls.map((url, i) => claim(`claim-${i + 1}`, url)), { claims: urls.map((url, i) => integrated(`claim-${i + 1}`, url)) }, new Map(urls.map((url, i) => [url, { title: "正文", sourceUrl: url, content: `claim-${i + 1} 正文确认资本事项。`, evidenceStatus: "full" as const }])), sources(urls), { start, end });
  assert.equal(result.reviewedClaimCount, 3, "3 个候选必须逐条完成集成审校");
  assert.equal(result.claims.filter((item) => item.classification === "fact").length, 3);
  assert.deepEqual(result.failureCodes, []);
}

{
  const result = reconcileIntegratedPublication([claim("claim-1", "https://example.test/a")], { claims: [integrated("claim-1", "https://example.test/a"), integrated("unknown-id", "https://example.test/a")] }, evidence("https://example.test/a", "claim-1 正文确认资本事项。"), sources(["https://example.test/a"]), { start, end });
  assert.equal(result.unknownClaimIdCount, 1);
  assert.ok(result.failureCodes.includes("CLAIM_ID_MAPPING_FAILED"));
  assert.equal(result.valid, true, "未知额外 ID 不得被当作合法候选，但有效输入 ID 仍可单独诊断");
}

{
  const urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  const result = reconcileIntegratedPublication(urls.map((url, i) => claim(`claim-${i + 1}`, url)), { claims: [integrated("claim-1", urls[0]), integrated("claim-2", urls[1])] }, new Map(urls.map((url, i) => [url, { title: "正文", sourceUrl: url, content: `claim-${i + 1} 正文确认资本事项。`, evidenceStatus: "full" as const }])), sources(urls), { start, end });
  assert.equal(result.claims.length, 3, "漏审候选必须保留在研究记录中");
  assert.equal(result.claims[2]?.discardReason, "集成审校未返回该候选的审校记录");
}

{
  const original = "https://example.test/a/";
  const result = reconcileIntegratedPublication([claim("claim-1", original)], { claims: [integrated("claim-1", "https://EXAMPLE.test/a/?utm_source=test")] }, evidence(original, "claim-1 正文确认资本事项。"), sources([original]), { start, end });
  assert.equal(result.unmappedEvidenceCount, 0, "参数、主机大小写和尾斜杠安全等价 URL 必须映射");
  assert.equal(result.claims[0]?.supportingEvidence.length, 1);
}

{
  const original = "https://example.test/a";
  const result = reconcileIntegratedPublication([claim("claim-1", original)], { claims: [integrated("claim-1", "https://invented.test/fake", { supportingEvidence: [{ url: "https://invented.test/fake", relevantText: "claim-1 正文确认资本事项。" }] })] }, evidence(original, "claim-1 正文确认资本事项。"), sources([original]), { start, end });
  assert.equal(result.unmappedEvidenceCount, 1);
  assert.ok(result.failureCodes.includes("EVIDENCE_MAPPING_FAILED"));
  assert.equal(result.claims[0]?.classification, "clue", "虚构 URL 不能支撑 fact");
}

{
  const urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  const result = reconcileIntegratedPublication(urls.map((url, i) => claim(`claim-${i + 1}`, url)), { claims: urls.map((url, i) => integrated(`claim-${i + 1}`, url, { relevanceToResearch: "low", classification: "clue", discardReason: `claim-${i + 1} 与研究目标不相关` })) }, new Map(urls.map((url, i) => [url, { title: "正文", sourceUrl: url, content: `claim-${i + 1} 正文确认资本事项。`, evidenceStatus: "full" as const }])), sources(urls), { start, end });
  const empty = classifyEmptyResult({ candidateClaimCount: 3, integratedReviewedClaimCount: 3, integratedUnknownClaimIdCount: 0, unmappedEvidenceCount: 0, discardedClaimCount: result.discardedClaims.length, publishedFactCount: 0, publishedClueCount: 0, readableEvidenceCount: 3, retrievalStatus: "success", allCandidatesExplained: true });
  assert.equal(empty.classification, "legitimate_empty");
}

{
  const empty = classifyEmptyResult({ candidateClaimCount: 3, integratedReviewedClaimCount: 3, integratedUnknownClaimIdCount: 0, unmappedEvidenceCount: 0, discardedClaimCount: 0, publishedFactCount: 0, publishedClueCount: 0, readableEvidenceCount: 0, retrievalStatus: "partial", allCandidatesExplained: false });
  assert.equal(empty.classification, "coverage_insufficient");
  assert.match(empty.reason || "", /覆盖不足/);
}

{
  const result = reconcileIntegratedPublication([claim("c1", "https://example.test/a")], { claims: [] }, evidence("https://example.test/a", "c1 正文确认资本事项。"), sources(["https://example.test/a"]), { start, end });
  const empty = classifyEmptyResult({ candidateClaimCount: 1, integratedReviewedClaimCount: result.reviewedClaimCount, integratedUnknownClaimIdCount: result.unknownClaimIdCount, unmappedEvidenceCount: result.unmappedEvidenceCount, discardedClaimCount: 0, publishedFactCount: 0, publishedClueCount: 0, readableEvidenceCount: 1, retrievalStatus: "success", allCandidatesExplained: false });
  assert.equal(result.valid, false);
  assert.equal(empty.classification, "pipeline_empty");
}

{
  const empty = classifyEmptyResult({ candidateClaimCount: 14, integratedReviewedClaimCount: 0, integratedUnknownClaimIdCount: 0, unmappedEvidenceCount: 0, discardedClaimCount: 0, publishedFactCount: 0, publishedClueCount: 0, readableEvidenceCount: 10, retrievalStatus: "success", allCandidatesExplained: false });
  assert.equal(empty.classification, "pipeline_empty", "14 次阅读、10 个 full、最终全空且无逐项解释必须失败");
}

console.log("research quality phase2 FIX-04 tests passed");
