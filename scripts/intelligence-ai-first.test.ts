import assert from "node:assert/strict";
import { runAiFirstResearch, enforceClaimPublicationGate, type ResearchClaim } from "@/lib/intelligenceResearchAgent";
import { normalizeTaskInput } from "@/lib/intelligence";
import type { IntelligenceProvider, RetrievalRequest, RetrievalResult } from "@/lib/intelligenceProvider";

const prompts: string[] = [];
let alignmentCalls = 0;
const generationProvider: IntelligenceProvider = {
  id: "mock-deepseek",
  capabilities: { generation: true, nativeWebSearch: false },
  async generate({ system, prompt }) {
    prompts.push(`${system}\n${prompt}`);
    if (system.includes("[PHASE:research-plan]")) return JSON.stringify({
      understanding: "核验研究窗口内中国大模型企业的具体资本事件",
      eventTypes: ["融资", "战略投资", "上市流动性"],
      likelyEntities: ["DeepSeek", "MiniMax"],
      queries: ["中国大模型企业 2026年8月6日至9日 融资"],
      deepDiveCriteria: ["重大金额或估值必须二次求证"],
    });
    if (system.includes("[PHASE:research-review]")) return JSON.stringify({
      candidateClaims: [
        { statement: "DeepSeek 8月6日恢复第二轮融资、目标80亿美元，同时国家AI基金7月入股", eventDate: "2026-08-06", entities: ["DeepSeek", "国家AI基金"], eventType: "融资及入股", significance: "重大融资", confidence: "high", sourceUrls: ["https://media.example/deepseek"] },
        { statement: "MiniMax 8月6日纳入港股通，成为首个向内地资金开放的国产大模型公司", eventDate: "2026-08-06", entities: ["MiniMax"], eventType: "港股通", significance: "改善流动性", confidence: "high", sourceUrls: ["https://exchange.example/minimax"] },
        { statement: "图灵量子启动A股上市辅导", eventDate: "2026-08-07", entities: ["图灵量子"], eventType: "上市辅导", significance: "资本市场动作", confidence: "medium", sourceUrls: ["https://local.example/turing"] },
      ],
      followUpQueries: [],
      stop: true,
    });
    if (system.includes("[PHASE:claim-atomization]")) return JSON.stringify({ claims: [
      { parentId: "claim-1", statement: "DeepSeek于8月6日恢复第二轮融资，融资规模接近80亿美元", eventDate: "2026-08-06", entities: ["DeepSeek"], eventType: "融资", significance: "重大融资", confidence: "high", sourceUrls: ["https://media.example/deepseek"] },
      { parentId: "claim-1", statement: "国家AI基金于7月入股DeepSeek", eventDate: "2026-07-20", entities: ["DeepSeek", "国家AI基金"], eventType: "战略投资", significance: "历史资本背景", confidence: "medium", sourceUrls: ["https://media.example/deepseek"] },
      { parentId: "claim-2", statement: "MiniMax于8月6日纳入港股通，成为首个向内地资金开放的国产大模型公司", eventDate: "2026-08-06", entities: ["MiniMax"], eventType: "港股通", significance: "改善流动性", confidence: "high", sourceUrls: ["https://exchange.example/minimax"] },
      { parentId: "claim-3", statement: "图灵量子启动A股上市辅导", eventDate: "2026-08-07", entities: ["图灵量子"], eventType: "上市辅导", significance: "资本市场动作", confidence: "medium", sourceUrls: ["https://local.example/turing"] },
    ] });
    if (system.includes("[PHASE:claim-evidence-alignment]")) {
      alignmentCalls++;
      return JSON.stringify({ claims: [
        { id: "claim-1", supportingEvidence: alignmentCalls === 1
          ? [{ url: "https://media.example/deepseek", relevantText: "消息称DeepSeek于8月6日重启第二轮融资。", publishedAt: "2026-08-06" }]
          : [{ url: "https://reuters.example/deepseek", relevantText: "DeepSeek reopened its second funding round on August 6, seeking nearly $8 billion at a valuation around RMB 500 billion.", publishedAt: "2026-08-08" }], needsVerificationSearch: alignmentCalls === 1, verificationQueries: alignmentCalls === 1 ? ["DeepSeek second funding round August 6 2026 Reuters 80亿美元 5000亿元估值"] : [] },
        { id: "claim-2", supportingEvidence: [{ url: "https://media.example/deepseek", relevantText: "国家人工智能基金于7月20日完成对DeepSeek的入股。", publishedAt: "2026-08-08" }] },
        { id: "claim-3", supportingEvidence: [{ url: "https://exchange.example/minimax", relevantText: "MiniMax自8月6日起纳入港股通标的名单。", publishedAt: "2026-08-06" }] },
        { id: "claim-4", supportingEvidence: [{ url: "https://local.example/turing", relevantText: "图灵量子启动A股上市辅导。河南另有弹性离岗政策。", publishedAt: "2026-08-07" }] },
      ] });
    }
    if (system.includes("[PHASE:verification-source-review]")) return JSON.stringify({ claims: [
      { id: "claim-1", sourceUrls: ["https://reuters.example/deepseek"] },
    ] });
    if (system.includes("[PHASE:claim-verification]")) return JSON.stringify({ claims: [
      { id: "claim-1", statement: "DeepSeek于8月6日恢复第二轮融资，融资规模接近80亿美元，目标估值约5000亿元人民币", eventDate: "2026-08-06", entities: ["DeepSeek"], eventType: "融资", significance: "融资规模与估值均显示较高资本需求", confidence: "high", classification: "fact", relevanceToResearch: "high" },
      { id: "claim-2", statement: "国家AI基金于7月入股DeepSeek", eventDate: "2026-07-20", backgroundDate: "2026-07-20", entities: ["DeepSeek", "国家AI基金"], eventType: "战略投资", significance: "可作为本期融资的历史背景", confidence: "medium", classification: "background", relevanceToResearch: "high" },
      { id: "claim-3", statement: "MiniMax于8月6日纳入港股通", eventDate: "2026-08-06", entities: ["MiniMax"], eventType: "港股通", significance: "可能改善股票流动性", confidence: "high", classification: "fact", relevanceToResearch: "high" },
      { id: "claim-4", statement: "图灵量子启动A股上市辅导", eventDate: "2026-08-07", entities: ["图灵量子"], eventType: "上市辅导", significance: "与大模型企业缺乏明确关联", confidence: "low", classification: "clue", relevanceToResearch: "low", discardReason: "证据未显示其属于中国AI大模型企业" },
    ] });
    if (system.includes("[PHASE:final-synthesis]")) return JSON.stringify({
      brief: "【资本动态】1. DeepSeek于8月6日恢复第二轮融资，拟募资接近80亿美元，目标估值约5000亿元。2. MiniMax于8月6日纳入港股通。\n【简评】前者若按目标完成，将强化头部模型公司的资本密集特征；后者主要影响二级市场流动性。国家AI基金7月入股仅作为融资背景，不属于本期新增。",
      overview: "",
      items: [
        { claimId: "claim-1", title: "DeepSeek恢复第二轮融资", summary: "拟募资接近80亿美元，目标估值约5000亿元人民币。", editorial: "融资规模显示训练与算力投入仍需要大额资本。" },
        { claimId: "claim-3", title: "MiniMax纳入港股通", summary: "自8月6日起纳入港股通标的。", editorial: "应继续观察南向资金参与和流动性变化。" },
      ],
      trends: [],
    });
    if (system.includes("[PHASE:final-brief-entailment]")) return JSON.stringify({
      brief: "【资本动态】1. DeepSeek于8月6日恢复第二轮融资，拟募资接近80亿美元，目标估值约5000亿元。2. MiniMax于8月6日纳入港股通。这是窗口期唯一事件。无其他融资获得证据。\n【简评】前者若按目标完成，将强化头部模型公司的资本密集特征；后者主要影响二级市场流动性。国家AI基金7月入股仅作为融资背景，不属于本期新增。",
    });
    throw new Error(`unexpected phase: ${system}`);
  },
};

const retrievalCalls: string[][] = [];
const retrieval = {
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    retrievalCalls.push(request.queries || []);
    const verification = request.queries?.some((query) => query.includes("Reuters"));
    const results = verification ? [
      { title: "DeepSeek reopens second funding round", url: "https://reuters.example/deepseek", siteName: "Reuters", snippet: "DeepSeek seeks nearly $8 billion.", publishedAt: "2026-08-08", sourceTier: "A" as const, domain: "reuters.example", query: request.queries?.[0] || "" },
    ] : [
      { title: "DeepSeek融资与国家基金入股", url: "https://media.example/deepseek", siteName: "财经媒体", snippet: "文章同时回顾7月入股并报道8月融资。", publishedAt: "2026-08-08", sourceTier: "A" as const, domain: "media.example", query: request.queries?.[0] || "" },
      { title: "MiniMax纳入港股通", url: "https://exchange.example/minimax", siteName: "交易所", snippet: "MiniMax纳入港股通。", publishedAt: "2026-08-06", sourceTier: "S" as const, domain: "exchange.example", query: request.queries?.[0] || "" },
      { title: "图灵量子上市辅导及河南弹性离岗", url: "https://local.example/turing", siteName: "地方媒体", snippet: "图灵量子启动上市辅导。河南发布弹性离岗消息。", publishedAt: "2026-08-07", sourceTier: "C" as const, domain: "local.example", query: request.queries?.[0] || "" },
    ];
    return { status: "success", providers: [{ provider: "mock-retrieval", attempted: true, succeeded: true, queryCount: request.queries?.length || 0, resultCount: results.length }], results };
  },
};

const evidenceText: Record<string, string> = {
  "https://media.example/deepseek": "消息称DeepSeek于8月6日重启第二轮融资。国家人工智能基金于7月20日完成对DeepSeek的入股。",
  "https://exchange.example/minimax": "MiniMax自8月6日起纳入港股通标的名单。",
  "https://local.example/turing": "图灵量子启动A股上市辅导。河南另有弹性离岗政策。",
  "https://reuters.example/deepseek": "DeepSeek reopened its second funding round on August 6, seeking nearly $8 billion at a valuation around RMB 500 billion.",
};

const input = normalizeTaskInput({
  name: "收集2026/8/6至2026/8/9中国AI大模型企业资本动态，并简要述评，不超过500字。",
  topics: ["AI大模型"], keywords: ["融资", "投资", "并购", "估值"], regions: ["中国"],
  lookbackPeriod: { kind: "custom", start: "2026-08-06T00:00:00.000Z", end: "2026-08-09T23:59:59.999Z" },
  outputInstructions: "简要述评，不超过500字。", maxItems: 10, isActive: true,
});

async function main() {
  const result = await runAiFirstResearch(input, { start: new Date("2026-08-06T00:00:00.000Z"), end: new Date("2026-08-09T23:59:59.999Z") }, {
    generationProvider,
    retrieval,
    acquireEvidence: (async (candidates: any[]) => {
      for (const candidate of candidates) {
        candidate.evidenceStatus = evidenceText[candidate.sourceUrl] ? "full" : "unavailable";
        candidate.content = evidenceText[candidate.sourceUrl] || candidate.content;
        candidate.evidencePublishedAt = candidate.sourceUrl.includes("reuters") ? "2026-08-08" : null;
      }
      const full = candidates.filter((candidate) => candidate.evidenceStatus === "full").length;
      return { candidates, stats: { attempted: candidates.length, full, partial: 0, unavailable: candidates.length - full } };
    }) as any,
  });

  assert.equal(result.research.rounds.some((round) => round.stage === "verification"), true, "重大弱证据 claim 必须触发 verification search");
  assert.match(retrievalCalls.flat().join(" "), /DeepSeek.*Reuters.*80亿美元.*5000亿元/, "求证 query 应针对重大 claim 的缺口");
  assert.equal(result.research.verifiedClaims.length, 3, "低相关 claim 应从最终 claims 删除");
  assert.equal(result.research.discardedClaims.some((claim) => claim.statement.includes("图灵量子")), true, "AI 低相关判断必须可追溯");
  assert.equal(result.importantFacts.length, 2);
  assert.equal(result.otherItems.length, 0);
  assert.equal(result.editorialBackground.some((claim) => claim.statement.includes("国家AI基金") && claim.backgroundDate?.startsWith("2026-07")), true, "7月事件只能作为历史背景");
  assert.equal(result.importantFacts.some((item) => item.title.includes("首次")), false, "无证据的比较性表达必须删除");
  assert.equal(result.importantFacts.some((item) => item.title.includes("河南弹性离岗")), false, "无关页面内容不得形成结果");
  assert.equal(result.research.verifiedClaims.find((claim) => claim.statement.includes("80亿美元"))?.supportingEvidence[0]?.url, "https://reuters.example/deepseek", "claim 必须只引用与其相关的 evidence span");
  assert.equal(result.research.verifiedClaims.find((claim) => claim.statement.includes("80亿美元"))?.supportingEvidence[0]?.publishedAt, "2026-08-08T00:00:00.000Z", "证据发布时间必须使用可解析的页面/来源日期");
  assert.match(result.overview, /^【资本动态】/);
  assert.doesNotMatch(result.overview, /唯一事件|无其他融资/, "final audit 后仍无 claim 支持的覆盖性断言必须删除");
  assert.ok(result.overview.length <= 500, "最终简报必须不超过500字");
  assert.equal(prompts.some((prompt) => /一个输出 claim 只能有一个主体事件/.test(prompt)), true, "Atomic Claim 规则必须进入模型阶段");
  assert.equal(prompts.some((prompt) => /relevanceToResearch=high\/medium\/low/.test(prompt)), true, "研究目标一致性必须由 AI 判断");
  assert.equal(prompts.some((prompt) => /重大但弱证据的具体事件不能在正文取证前被早删/.test(prompt)), true, "重大弱证据事件必须进入 AI 求证链而不是早删");

  const unsupported = enforceClaimPublicationGate({ id: "x", statement: "甲公司完成100亿美元融资", eventDate: null, backgroundDate: null, entities: ["甲公司"], eventType: "融资", significance: "", confidence: "high", sourceUrls: ["https://x.example"], evidenceStatus: "unavailable", classification: "fact", relevanceToResearch: "high", supportingEvidence: [] } satisfies ResearchClaim);
  assert.equal(unsupported.classification, "clue");
  assert.notEqual(unsupported.confidence, "high");

  const emptyProvider: IntelligenceProvider = {
    id: "mock-empty",
    capabilities: { generation: true, nativeWebSearch: false },
    async generate({ system }) {
      if (system.includes("[PHASE:research-plan]")) return JSON.stringify({ understanding: "核验窗口事件", eventTypes: ["融资"], likelyEntities: [], queries: ["宽泛检索一", "broad search two"], deepDiveCriteria: [] });
      if (system.includes("[PHASE:research-review]")) return JSON.stringify({ candidateClaims: [], followUpQueries: [], stop: true });
      if (system.includes("[PHASE:claim-atomization]")) return JSON.stringify({ claims: [] });
      if (system.includes("[PHASE:claim-evidence-alignment]")) return JSON.stringify({ claims: [] });
      if (system.includes("[PHASE:claim-verification]")) return JSON.stringify({ claims: [] });
      throw new Error("0 claim 时不得调用最终综合并自由补全事实");
    },
  };
  const emptyResult = await runAiFirstResearch(input, { start: new Date("2026-08-06T00:00:00.000Z"), end: new Date("2026-08-09T23:59:59.999Z") }, {
    generationProvider: emptyProvider,
    retrieval: { async retrieve(request) { return { status: "success", providers: [{ provider: "mock", attempted: true, succeeded: true, queryCount: request.queries?.length || 0, resultCount: 1 }], results: [{ title: "无关结果", url: "https://irrelevant.example", siteName: "来源", snippet: "无具体事件", publishedAt: null, sourceTier: "C", domain: "irrelevant.example", query: request.queries?.[0] || "" }] }; } },
    acquireEvidence: (async (candidates: any[]) => ({ candidates, stats: { attempted: 0, full: 0, partial: 0, unavailable: 0 } })) as any,
  });
  assert.equal(emptyResult.overview, "本期未发现符合条件、且可核验的新增事实。", "0 claim 必须诚实返回空结果，不能由模型补写检索范围或历史事件");

  const backgroundProvider: IntelligenceProvider = {
    id: "mock-background",
    capabilities: { generation: true, nativeWebSearch: false },
    async generate({ system }) {
      if (system.includes("[PHASE:research-plan]")) return JSON.stringify({ understanding: "核验本期事件", eventTypes: ["融资"], likelyEntities: ["甲公司"], queries: ["甲公司 融资"], deepDiveCriteria: [] });
      if (system.includes("[PHASE:research-review]")) return JSON.stringify({ candidateClaims: [{ statement: "甲公司5月估值100亿美元", eventDate: "2026-05-08", entities: ["甲公司"], eventType: "估值报道", significance: "历史背景", confidence: "low", sourceUrls: ["https://background.example"] }], followUpQueries: [], stop: true });
      if (system.includes("[PHASE:claim-atomization]")) return JSON.stringify({ claims: [{ parentId: "claim-1", statement: "甲公司5月估值100亿美元", eventDate: "2026-05-08", entities: ["甲公司"], eventType: "估值报道", significance: "历史背景", confidence: "low", sourceUrls: ["https://background.example"] }] });
      if (system.includes("[PHASE:claim-evidence-alignment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportingEvidence: [] }] });
      if (system.includes("[PHASE:claim-verification]")) return JSON.stringify({ claims: [{ id: "claim-1", statement: "甲公司5月估值100亿美元", eventDate: "2026-05-08", backgroundDate: "2026-05-08", entities: ["甲公司"], eventType: "估值报道", significance: "历史背景", confidence: "low", classification: "background", relevanceToResearch: "medium" }] });
      throw new Error("无 supporting evidence 的 Background 不得进入最终综合");
    },
  };
  const backgroundResult = await runAiFirstResearch(input, { start: new Date("2026-08-06T00:00:00.000Z"), end: new Date("2026-08-09T23:59:59.999Z") }, {
    generationProvider: backgroundProvider,
    retrieval: { async retrieve(request) { return { status: "success", providers: [{ provider: "mock", attempted: true, succeeded: true, queryCount: request.queries?.length || 0, resultCount: 1 }], results: [{ title: "甲公司历史估值报道", url: "https://background.example", siteName: "来源", snippet: "媒体称估值100亿美元", publishedAt: "2026-08-08", sourceTier: "C", domain: "background.example", query: request.queries?.[0] || "" }] }; } },
    acquireEvidence: (async (candidates: any[]) => ({ candidates: candidates.map((candidate) => ({ ...candidate, evidenceStatus: "unavailable" })), stats: { attempted: 1, full: 0, partial: 0, unavailable: 1 } })) as any,
  });
  assert.equal(backgroundResult.overview, "本期未发现符合条件、且可核验的新增事实。", "无正文支持的历史金额不得进入最终简报");
  assert.equal(backgroundResult.research.verifiedClaims.length, 1, "历史 Background 可保留在内部研究结构");

  console.log("intelligence ai-first 02 tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
