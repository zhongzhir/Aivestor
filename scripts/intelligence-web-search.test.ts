import assert from "node:assert/strict";
import { filterCandidatesWithReasons, mergeCandidates } from "@/lib/intelligence";
import { normalizeWebResults, planIntelligenceQueries, buildIntelligenceSearchRuns, WEB_SEARCH_SYSTEM_PROMPT, INTELLIGENCE_SEARCH_LIMITS } from "@/lib/intelligenceWebSearch";
import { normalizeTaskInput } from "@/lib/intelligence";
import { sourceQualityForDomain } from "@/lib/intelligenceSourceQuality";
import { topicRelevance } from "@/lib/intelligenceTopicRelevance";
import { buildEditorialCommentary, buildEditorialOverview, enrichCandidate, isClueQualityEligible, mergeEventCandidates, partitionBriefItems } from "@/lib/intelligenceBriefQuality";

const themes = [
  normalizeTaskInput({ name: "中国 AI 大模型企业资本新闻监测", topics: ["AI 大模型"], entities: ["中国企业"], keywords: ["资本", "融资"] }),
  normalizeTaskInput({ name: "中国创新药海外 BD 交易", topics: ["创新药"], entities: ["中国企业"], keywords: ["海外 BD", "交易"] }),
  normalizeTaskInput({ name: "北京商业航天融资与政策动态", topics: ["商业航天"], regions: ["北京"], keywords: ["融资", "政策"] }),
];
for (const theme of themes) assert.ok(planIntelligenceQueries(theme).length >= 1 && planIntelligenceQueries(theme).length <= 4);
const runs = buildIntelligenceSearchRuns(themes[0]);
assert.equal(runs.length, 4);
assert.equal(runs[0].purpose, "general");
assert.equal(runs[0].assigned.length, 0, "general search must remain unrestricted");
assert.equal(runs[1].purpose, "high-quality");
assert.ok(runs[1].assigned.includes("36kr.com"));

const raw = { search_info: { search_results: [{ title: "创新药海外授权交易", url: "https://example.com/news?id=1&utm_source=test", site_name: "Example", snippet: "企业完成海外授权合作", date: "2026-08-08" }] } };
const normalized = normalizeWebResults(raw, "创新药 海外 BD");
assert.equal(normalized[0].url, "https://example.com/news?id=1");
assert.equal(normalized[0].siteName, "Example");
assert.equal(normalized[0].sourceTier, "C");
assert.equal(normalizeWebResults({ search_results: [{ title: "36氪报道融资", url: "https://www.36kr.com/p/1", site_name: "36氪" }] }, "融资")[0].sourceTier, "A");
assert.equal(normalizeWebResults({ search_results: [{ title: "监管公告", url: "https://www.gov.cn/xinwen/2026-08/08/content.htm", site_name: "政府" }] }, "政策")[0].sourceTier, "S");
assert.equal(sourceQualityForDomain("xueqiu.com"), "C");
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

const pharma = normalizeTaskInput({ name: "中国创新药海外 BD 交易", topics: ["创新药"], keywords: ["海外 BD", "交易"] });
const aiCapital = normalizeTaskInput({ name: "中国 AI 大模型企业资本动态", topics: ["AI", "大模型"], keywords: ["融资", "投资"] });
const space = normalizeTaskInput({ name: "北京商业航天融资与政策动态", topics: ["商业航天"], regions: ["北京"], keywords: ["融资", "政策"] });
const productionConfig = normalizeTaskInput({
  name: "中国AI大模型企业资本动态",
  topics: ["AI大模型", "资本动态"],
  entities: ["中国AI大模型企业"],
  keywords: ["AI大模型", "资本", "融资", "投资", "并购", "估值"],
  regions: ["中国"],
});
assert.deepEqual(productionConfig.topics, ["AI大模型"]);
assert.ok(productionConfig.keywords.includes("资本动态"));
assert.deepEqual(productionConfig.entities, [], "泛化企业类别不应作为具体实体");
const monthScoped = normalizeTaskInput({
  name: "中国机器人企业8月资本动态",
  topics: ["机器人"],
  keywords: ["资本动态"],
  lookbackPeriod: { kind: "custom", start: "2026-08-01T00:00:00.000Z", end: "2026-08-14T00:00:00.000Z" },
});
assert.ok(planIntelligenceQueries(monthScoped).every((query) => query.includes("2026年8月")), "自定义月份必须进入检索词，避免搜索引擎回落到历史年份");

const smokeCandidate = (title: string, content: string, id = title): any => ({ id, title, content, source: "smoke", sourceUrl: `https://example.com/${id}`, publishedAt: "2026-08-08T00:00:00.000Z", subject: title, region: null, kind: "fact", sourceTier: "C", origin: "web-search" });
const recent = new Date("2026-08-01T00:00:00.000Z");
const end = new Date("2026-08-09T00:00:00.000Z");
const preCases = filterCandidatesWithReasons([
  smokeCandidate("月之暗面完成新一轮融资", "AI公司月之暗面完成融资", "moon"),
  smokeCandidate("智谱完成融资", "AI大模型公司智谱完成融资", "zhipu"),
  smokeCandidate("阿里发布新模型", "阿里发布新模型并开启公测", "product"),
  smokeCandidate("美国 Anthropic 完成融资", "美国 Anthropic 完成融资，没有中国主体", "foreign"),
  smokeCandidate("中国AI行业年度融资回顾", "中国AI行业年度融资回顾与累计交易统计", "review"),
  smokeCandidate("AI 大模型公司完成融资", "正文披露该 AI 大模型公司完成一轮融资", "body"),
], productionConfig, recent, end, "pre-evidence", false);
assert.deepEqual(preCases.candidates.map((item) => item.id), ["moon", "zhipu", "body"]);
assert.equal(preCases.dropReasons.productOnly, 1);
assert.equal(preCases.dropReasons.regionMismatch, 1);
assert.equal(preCases.dropReasons.historicalReview, 1);
const postCases = filterCandidatesWithReasons(preCases.candidates.map((item) => ({ ...item, evidenceStatus: "full" as const })), productionConfig, recent, end, "post-evidence", true);
assert.deepEqual(postCases.candidates.map((item) => item.id), ["moon", "zhipu", "body"]);
const relevantBd: any = { id: "bd", title: "甲公司完成海外授权", content: "甲公司与海外买方达成 license-out", source: "x", sourceUrl: "https://xueqiu.com/a", publishedAt: "2026-08-08T00:00:00.000Z", subject: "甲公司", region: null, kind: "fact", sourceTier: "C", origin: "web-search" };
const productOnly: any = { id: "product", title: "大模型开启公测", content: "产品发布新版本", source: "x", sourceUrl: "https://x.example/a", publishedAt: "2026-08-08T00:00:00.000Z", subject: "大模型", region: null, kind: "fact", sourceTier: "A", origin: "web-search" };
const spaceOpinion: any = { id: "space", title: "商业航天景气元年", content: "行业观点认为技术突破", source: "x", sourceUrl: "https://x.example/s", publishedAt: "2026-08-08T00:00:00.000Z", subject: "商业航天", region: "北京", kind: "fact", sourceTier: "A", origin: "web-search", evidenceStatus: "full" };
assert.equal(topicRelevance(relevantBd, pharma).passed, true);
assert.equal(topicRelevance(productOnly, aiCapital).passed, false);
assert.equal(topicRelevance(spaceOpinion, space).passed, false);
const lowEvidenceClue = enrichCandidate({ ...relevantBd, evidenceStatus: "partial" }, pharma);
assert.equal(lowEvidenceClue.isClue, true);
const fullSingleCClue = enrichCandidate({ ...relevantBd, evidenceStatus: "full" }, pharma);
assert.equal(fullSingleCClue.isClue, true, "single C source must never become fact");
assert.doesNotMatch(fullSingleCClue.summary || "", /公开信息提到/);
const unavailableA = enrichCandidate({ ...relevantBd, id: "unavailable-a", sourceTier: "A", evidenceStatus: "unavailable" }, pharma);
assert.equal(unavailableA.isClue, true, "普通 A 级搜索结果无正文时不得晋级事实");
assert.equal(unavailableA.kind, "other");
const unavailableC = enrichCandidate({ ...relevantBd, id: "unavailable-c", sourceTier: "C", evidenceStatus: "unavailable" }, pharma);
assert.equal(unavailableC.isClue, true, "C 级搜索结果无正文时最多只能作为线索");
const moonClue = enrichCandidate({ ...relevantBd, id: "moon-clue", title: "月之暗面35亿美元融资", content: "月之暗面被报道完成35亿美元融资，具体轮次仍需核对。", sourceTier: "A", evidenceStatus: "unavailable" }, aiCapital);
assert.equal(moonClue.isClue, true, "具体融资事件可以保留为线索");
assert.equal(isClueQualityEligible(moonClue), true);
assert.ok(moonClue.summary && moonClue.summary !== "线索：", "具体线索必须有实质摘要");
const deepseekClue = enrichCandidate({ ...relevantBd, id: "deepseek-clue", title: "DeepSeek重启第二轮融资", content: "DeepSeek重启第二轮融资的消息仍待公司确认。", sourceTier: "C", evidenceStatus: "unavailable" }, aiCapital);
assert.equal(deepseekClue.isClue, true, "具体轮次事件可以保留为低置信线索");
assert.equal(isClueQualityEligible(deepseekClue), true);
const genericCommentary = enrichCandidate({ ...relevantBd, id: "generic-commentary", title: "资本仍在涌入AI", content: "资本仍在涌入AI，行业热度持续。", sourceTier: "A", evidenceStatus: "unavailable" }, aiCapital);
assert.equal(genericCommentary.isClue, false, "泛化资本评论不得保留为具体线索");
assert.equal(isClueQualityEligible(genericCommentary), true, "泛化评论可以作为低权重背景材料");
assert.equal(genericCommentary.importance, "low");
const genericPartition = partitionBriefItems([genericCommentary]);
assert.equal(genericPartition.otherItems.length, 0, "背景材料不得成为事件卡");
assert.equal(genericPartition.editorialBackground.length, 1);
assert.equal(genericPartition.trendSignals.length, 0);
const genericHype = enrichCandidate({ ...relevantBd, id: "generic-hype", title: "AI融资热潮持续", content: "AI融资热潮持续，市场关注度上升。", sourceTier: "A", evidenceStatus: "unavailable" }, aiCapital);
assert.equal(genericHype.isClue, false);
assert.equal(isClueQualityEligible(genericHype), true);
assert.equal(partitionBriefItems([genericHype]).editorialBackground.length, 1);
const titleOnlyClue = enrichCandidate({ ...relevantBd, id: "title-only-clue", title: "DeepSeek重启第二轮融资", content: "", sourceTier: "C", evidenceStatus: "unavailable" }, aiCapital);
assert.equal(titleOnlyClue.summary, "", "没有摘要正文时不得输出空壳线索前缀");
assert.match(titleOnlyClue.investmentNote || "", /若融资消息得到确认/);
assert.match(buildEditorialCommentary(moonClue) || "", /若融资消息得到确认/);
const separated = partitionBriefItems([moonClue, deepseekClue, genericCommentary, genericHype]);
const displayedClues = separated.otherItems.filter((item) => item.isClue);
assert.equal(displayedClues.length, 2, "最终 Clue 数必须等于实际展示的具体线索数");
assert.equal(separated.editorialBackground.length, 2);
assert.equal(separated.trendSignals.length, 0, "Background 不得形成 Trend");
const separatedOverview = buildEditorialOverview([...separated.importantFacts, ...separated.otherItems], aiCapital, separated.editorialBackground);
assert.match(separatedOverview, /月之暗面35亿美元融资/);
assert.match(separatedOverview, /DeepSeek重启第二轮融资/);
assert.doesNotMatch(separatedOverview, /值得继续核实：[^。]*(资本仍在涌入AI|AI融资热潮持续)/);
assert.match(separatedOverview, /简评：若相关融资消息后续得到确认/);
const verified = enrichCandidate({ ...relevantBd, id: "verified", sourceTier: "A", evidenceStatus: "full", content: "公司公告披露与海外买方达成 license-out，包含授权区域与交易进度。" }, pharma);
assert.equal(verified.isClue, false, "正文充分支持的候选可以成为事实");
const unavailableTrend = partitionBriefItems([
  enrichCandidate({ ...relevantBd, id: "unavailable-1", subject: "甲公司", evidenceStatus: "unavailable", sourceUrl: "https://x.example/u1" }, pharma),
  enrichCandidate({ ...relevantBd, id: "unavailable-2", subject: "乙公司", evidenceStatus: "unavailable", sourceUrl: "https://y.example/u2", title: "乙公司完成海外授权交易" }, pharma),
]);
assert.equal(unavailableTrend.trendSignals.length, 0, "两个无正文线索不得形成趋势");
const verifiedTrend = partitionBriefItems([
  enrichCandidate({ ...relevantBd, id: "verified-1", subject: "甲公司", evidenceStatus: "full", sourceTier: "A", sourceUrl: "https://x.example/v1", content: "甲公司与海外买方达成 license-out，披露授权区域与交易进度。" }, pharma),
  enrichCandidate({ ...relevantBd, id: "verified-2", subject: "乙公司", evidenceStatus: "full", sourceTier: "A", sourceUrl: "https://y.example/v2", title: "乙公司完成海外授权交易", content: "乙公司与海外买方达成 license-out，披露授权区域与交易进度。" }, pharma),
]);
assert.ok(verifiedTrend.trendSignals.length >= 1, "两个独立正文事实可以形成趋势");
const primary = mergeEventCandidates([
  { ...relevantBd, id: "c", source: "雪球", sourceTier: "C", sourceUrl: "https://xueqiu.com/c" },
  { ...relevantBd, id: "a", source: "36氪", sourceTier: "A", sourceUrl: "https://36kr.com/a" },
]);
assert.equal(primary[0].sourceTier, "A");
assert.equal(primary[0].source, "36氪");
console.log("intelligence web search tests passed");
