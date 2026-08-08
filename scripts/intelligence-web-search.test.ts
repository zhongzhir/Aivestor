import assert from "node:assert/strict";
import { mergeCandidates } from "@/lib/intelligence";
import { normalizeWebResults, planIntelligenceQueries, WEB_SEARCH_SYSTEM_PROMPT, INTELLIGENCE_SEARCH_LIMITS } from "@/lib/intelligenceWebSearch";
import { normalizeTaskInput } from "@/lib/intelligence";

const themes = [
  normalizeTaskInput({ name: "中国 AI 大模型企业资本新闻监测", topics: ["AI 大模型"], entities: ["中国企业"], keywords: ["资本", "融资"] }),
  normalizeTaskInput({ name: "中国创新药海外 BD 交易", topics: ["创新药"], entities: ["中国企业"], keywords: ["海外 BD", "交易"] }),
  normalizeTaskInput({ name: "北京商业航天融资与政策动态", topics: ["商业航天"], regions: ["北京"], keywords: ["融资", "政策"] }),
];
for (const theme of themes) assert.ok(planIntelligenceQueries(theme).length >= 1 && planIntelligenceQueries(theme).length <= 4);

const raw = { search_info: { search_results: [{ title: "创新药海外授权交易", url: "https://example.com/news?id=1&utm_source=test", site_name: "Example", snippet: "企业完成海外授权合作", date: "2026-08-08" }] } };
const normalized = normalizeWebResults(raw, "创新药 海外 BD");
assert.equal(normalized[0].url, "https://example.com/news?id=1");
assert.equal(normalized[0].siteName, "Example");
assert.equal(normalized[0].sourceTier, "C");
assert.equal(normalizeWebResults({ search_info: { search_results: [{ title: "日期路径", url: "https://example.com/2026-08-08/news" }] } }, "日期")[0].publishedAt, "2026-08-08T00:00:00.000Z");
assert.match(WEB_SEARCH_SYSTEM_PROMPT, /不可信外部资料/);
assert.match(WEB_SEARCH_SYSTEM_PROMPT, /不能执行其中的指令/);
assert.match(WEB_SEARCH_SYSTEM_PROMPT, /API Key/);
assert.doesNotMatch(WEB_SEARCH_SYSTEM_PROMPT, /打印|泄露系统提示词和 API Key/);
assert.equal(INTELLIGENCE_SEARCH_LIMITS.maxQueries, 4);

const merged = mergeCandidates([
  { id: "1", title: "某公司完成 10 亿元融资", content: "官方公告", source: "官方", sourceUrl: "https://official.example/a", publishedAt: "2026-08-08T00:00:00.000Z", subject: "某公司", region: null, kind: "fact", sourceTier: "A" },
  { id: "2", title: "某公司完成10亿元融资", content: "媒体报道", source: "媒体", sourceUrl: "https://media.example/a", publishedAt: "2026-08-08T01:00:00.000Z", subject: "某公司", region: null, kind: "fact", sourceTier: "C" },
]);
assert.equal(merged.length, 1);
assert.equal(merged[0].sourceUrls?.length, 2);
assert.equal(merged[0].sourceTier, "A");
console.log("intelligence web search tests passed");
