import assert from "node:assert/strict";
import { normalizeTaskInput } from "@/lib/intelligence";
import { resolvePublishedAt } from "@/lib/intelligenceBriefQuality";
import {
  enforceClaimPublicationGate,
  hasRetrievalProviderGap,
  packAgentSearchResults,
  renderPublicationContract,
  runAiFirstResearch,
  type ResearchClaim,
} from "@/lib/intelligenceResearchAgent";
import type { IntelligenceProvider, RetrievalRequest, RetrievalResult } from "@/lib/intelligenceProvider";

const input = normalizeTaskInput({
  name: "收集指定日期内某技术赛道企业资本动态，并简要述评，不超过500字。",
  topics: ["前沿技术"], keywords: ["融资", "投资", "上市"], regions: ["中国"],
  lookbackPeriod: { kind: "custom", start: "2026-08-06T00:00:00.000Z", end: "2026-08-09T23:59:59.999Z" },
  outputInstructions: "简要述评，不超过500字。", maxItems: 10, isActive: true,
});
const coverage = { start: new Date("2026-08-06T00:00:00.000Z"), end: new Date("2026-08-09T23:59:59.999Z") };

const prompts: string[] = [];
let alignmentCalls = 0;
let supervisorCalls = 0;
const generationProvider: IntelligenceProvider = {
  id: "mock-generation",
  capabilities: { generation: true, nativeWebSearch: false },
  async generate({ system, prompt }) {
    prompts.push(`${system}\n${prompt}`);
    if (system.includes("[PHASE:research-plan]")) return JSON.stringify({
      understanding: "核验窗口内具体资本事件", eventTypes: ["融资", "上市流动性"], likelyEntities: ["甲公司", "乙公司"],
      queries: ["前沿技术企业 资本事件"], deepDiveCriteria: ["重大金额须二次求证"],
    });
    if (system.includes("[PHASE:research-review]")) return JSON.stringify({ candidateClaims: [
      { statement: "甲公司5月完成战略投资，同时8月启动新融资", eventDate: "2026-08-06", entities: ["甲公司"], eventType: "投资及融资", significance: "重大资本事项", confidence: "high", sourceUrls: ["https://media.example/alpha"] },
      { statement: "乙公司8月7日纳入交易互联机制，并成为首家同类企业", eventDate: "2026-08-07", entities: ["乙公司"], eventType: "上市流动性", significance: "改善流动性", confidence: "high", sourceUrls: ["https://exchange.example/beta"] },
      { statement: "丙公司启动上市辅导", eventDate: "2026-08-07", entities: ["丙公司"], eventType: "上市辅导", significance: "资本市场动作", confidence: "medium", sourceUrls: ["https://local.example/gamma"] },
    ], followUpQueries: [], stop: true });
    if (system.includes("[PHASE:claim-atomization]")) return JSON.stringify({ claims: [
      { parentId: "claim-1", statement: "甲公司于5月完成战略投资", eventDate: "2026-05-08", entities: ["甲公司"], eventType: "战略投资", significance: "历史背景", confidence: "medium", sourceUrls: ["https://media.example/alpha"] },
      { parentId: "claim-1", statement: "甲公司于8月6日启动新融资，拟募资80亿元", eventDate: "2026-08-06", entities: ["甲公司"], eventType: "融资", significance: "重大融资", confidence: "high", sourceUrls: ["https://media.example/alpha"] },
      { parentId: "claim-2", statement: "乙公司于8月7日纳入交易互联机制，并成为首家同类企业", eventDate: "2026-08-07", entities: ["乙公司"], eventType: "上市流动性", significance: "改善流动性", confidence: "high", sourceUrls: ["https://exchange.example/beta"] },
      { parentId: "claim-3", statement: "丙公司启动上市辅导", eventDate: "2026-08-07", entities: ["丙公司"], eventType: "上市辅导", significance: "关联度待确认", confidence: "medium", sourceUrls: ["https://local.example/gamma"] },
      { parentId: "claim-1", statement: "据报道甲公司8月6日开展一轮80亿元融资", eventDate: "2026-08-06", entities: ["甲公司"], eventType: "融资", significance: "同一融资的重复表达", confidence: "medium", sourceUrls: ["https://media.example/alpha"] },
    ] });
    if (system.includes("[PHASE:research-supervisor]")) {
      supervisorCalls++;
      return JSON.stringify({
        coverageMap: {
          researchDimensions: [
            { dimension: "窗口内重大资本交易", importance: "critical", discoveredClaims: ["claim-2"], coverage: "weak", nextQuestions: ["是否还有未发现的直接资本动作"] },
            { dimension: "资本市场准入变化", importance: "high", discoveredClaims: ["claim-3"], coverage: "strong", nextQuestions: [] },
            { dimension: "尚未覆盖的重要资本事项", importance: "high", discoveredClaims: [], coverage: "missing", nextQuestions: ["窗口内还有哪些高价值事项"] },
          ],
          highestValueGaps: ["尚未覆盖的重要资本事项"],
        },
        prioritizedClaims: [
          { claimId: "claim-2", priority: "critical", reason: "窗口内重大融资且金额待核" },
          { claimId: "claim-3", priority: "high", reason: "窗口内流动性事项" },
          { claimId: "claim-1", priority: "low", reason: "仅为窗口前背景" },
        ],
        mergedClaims: supervisorCalls === 1 ? [{ canonicalClaimId: "claim-2", duplicateClaimIds: ["claim-5"], reason: "主体、动作、日期和金额语义相同" }] : [],
        verificationTargets: supervisorCalls > 2 ? [{ claimId: "claim-2", priority: "critical", gaps: ["金额", "投资方"], queries: ["甲公司 8月融资 金额 投资方 官方公告"] }] : [],
        gapFillQueries: supervisorCalls === 1 ? ["补充覆盖 尚未研究的重大资本事项"] : [], stopReason: supervisorCalls === 1 ? "仍有覆盖缺口" : "主要事件已覆盖",
      });
    }
    if (system.includes("[PHASE:gap-fill-review]")) return JSON.stringify({ candidateClaims: [], followUpQueries: [], stop: true });
    if (system.includes("[PHASE:claim-evidence-alignment]")) {
      alignmentCalls++;
      return JSON.stringify({ claims: [
        { id: "claim-1", supportingEvidence: [{ url: "https://media.example/alpha", relevantText: "甲公司于5月8日完成战略投资。", publishedAt: "2026-08-08" }] },
        { id: "claim-2", supportingEvidence: alignmentCalls === 1 ? [] : [{ url: "https://primary.example/alpha", relevantText: "公告确认甲公司于8月6日启动融资，拟募资80亿元。", publishedAt: "2069-08-08" }] },
        { id: "claim-3", supportingEvidence: [{ url: "https://exchange.example/beta", relevantText: "乙公司自8月7日起纳入交易互联机制。", publishedAt: "2026-08-07" }] },
        { id: "claim-4", supportingEvidence: [{ url: "https://local.example/gamma", relevantText: "丙公司启动上市辅导。另有无关劳动政策。", publishedAt: "2026-08-07" }] },
      ] });
    }
    if (system.includes("[PHASE:verification-source-review]")) return JSON.stringify({ claims: [{ id: "claim-2", sourceUrls: ["https://primary.example/alpha"] }] });
    if (system.includes("[PHASE:claim-verification]")) return JSON.stringify({ claims: [
      { id: "claim-1", statement: "甲公司于5月完成战略投资", eventDate: "2026-05-08", backgroundDate: "2026-05-08", entities: ["甲公司"], eventType: "战略投资", significance: "历史背景", confidence: "medium", classification: "background", relevanceToResearch: "high" },
      { id: "claim-2", statement: "甲公司于8月6日启动新融资，拟募资80亿元", eventDate: "2026-08-06", entities: ["甲公司"], eventType: "融资", significance: "融资规模较大", confidence: "high", classification: "fact", relevanceToResearch: "high" },
      { id: "claim-3", statement: "乙公司于8月7日纳入交易互联机制，股价上涨4.42%", eventDate: "2026-08-07", entities: ["乙公司"], eventType: "上市流动性", significance: "可能改善流动性", confidence: "high", classification: "fact", relevanceToResearch: "high" },
      { id: "claim-4", statement: "丙公司启动上市辅导", eventDate: "2026-08-07", entities: ["丙公司"], eventType: "上市辅导", significance: "与目标赛道缺乏明确关联", confidence: "low", classification: "clue", relevanceToResearch: "low", discardReason: "证据未显示其属于目标赛道" },
    ] });
    if (system.includes("[PHASE:evidence-entailment-rewrite]")) return JSON.stringify({ claims: [
      { id: "claim-1", supportedStatement: "甲公司于5月完成战略投资", unsupportedDetails: [], classification: "background" },
      { id: "claim-2", supportedStatement: "甲公司于8月6日启动新融资，拟募资80亿元", unsupportedDetails: [], classification: "fact" },
      { id: "claim-3", supportedStatement: "乙公司于8月7日纳入交易互联机制", unsupportedDetails: ["股价上涨4.42%"], classification: "fact" },
    ] });
    if (system.includes("[PHASE:final-synthesis]")) return JSON.stringify({
      sentences: [
        { text: "甲公司于8月6日启动新融资，拟募资80亿元。", mode: "fact", supportingClaimIds: ["claim-2"] },
        { text: "乙公司于8月7日纳入交易互联机制。", mode: "fact", supportingClaimIds: ["claim-3"] },
        { text: "甲公司5月的战略投资是本期新增。", mode: "fact", supportingClaimIds: ["claim-1"] },
        { text: "若融资完成，资金需求仍值得持续观察。", mode: "analysis", supportingClaimIds: ["claim-2"] },
      ],
      items: [
        { claimId: "claim-2", title: "甲公司启动新融资", summary: "拟募资80亿元。", editorial: "融资规模反映资金需求。" },
        { claimId: "claim-3", title: "乙公司纳入交易互联机制", summary: "自8月7日起生效。", editorial: "应观察后续流动性。" },
      ], trends: [],
    });
    throw new Error(`unexpected phase: ${system}`);
  },
};

const retrievalCalls: string[][] = [];
const retrieval = {
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    retrievalCalls.push(request.queries || []);
    const verification = request.queries?.some((query) => query.includes("投资方"));
    const gapFill = request.queries?.some((query) => query.includes("补充覆盖"));
    const results = verification ? [
      { title: "甲公司融资公告", url: "https://primary.example/alpha", siteName: "公告平台", snippet: "甲公司拟募资80亿元。", publishedAt: "2069-08-08", sourceTier: "S" as const, domain: "primary.example", query: request.queries?.[0] || "" },
    ] : gapFill ? [
      { title: "赛道资本事项补充检索", url: "https://coverage.example/sector", siteName: "行业媒体", snippet: "未发现新的具体事件。", publishedAt: "2026-08-08", sourceTier: "B" as const, domain: "coverage.example", query: request.queries?.[0] || "" },
    ] : [
      { title: "甲公司投资及融资报道", url: "https://media.example/alpha", siteName: "财经媒体", snippet: "文章回顾5月投资并报道8月融资。", publishedAt: "2026-08-08", sourceTier: "A" as const, domain: "media.example", query: request.queries?.[0] || "" },
      { title: "乙公司纳入交易互联机制", url: "https://exchange.example/beta", siteName: "交易所", snippet: "乙公司纳入交易互联机制。", publishedAt: "2026-08-07", sourceTier: "S" as const, domain: "exchange.example", query: request.queries?.[0] || "" },
      { title: "丙公司上市辅导及地方政策", url: "https://local.example/gamma", siteName: "地方媒体", snippet: "丙公司启动上市辅导。", publishedAt: "2026-08-07", sourceTier: "C" as const, domain: "local.example", query: request.queries?.[0] || "" },
    ];
    return { status: "success", providers: [{ provider: "mock-retrieval", attempted: true, succeeded: true, queryCount: request.queries?.length || 0, resultCount: results.length }], results };
  },
};

const evidenceText: Record<string, string> = {
  "https://media.example/alpha": "甲公司于5月8日完成战略投资。报道还提及8月融资。",
  "https://exchange.example/beta": "乙公司自8月7日起纳入交易互联机制。",
  "https://local.example/gamma": "丙公司启动上市辅导。另有无关劳动政策。",
  "https://primary.example/alpha": "公告确认甲公司于8月6日启动融资，拟募资80亿元。",
};

const emptyAgenda = { coverageMap: { researchDimensions: [], highestValueGaps: [] }, prioritizedClaims: [], mergedClaims: [], verificationTargets: [], gapFillQueries: [], stopReason: "无候选" };

async function main() {
  const result = await runAiFirstResearch(input, coverage, {
    generationProvider, retrieval,
    acquireEvidence: (async (candidates: any[]) => {
      for (const candidate of candidates) {
        candidate.evidenceStatus = evidenceText[candidate.sourceUrl] ? "full" : "unavailable";
        candidate.content = evidenceText[candidate.sourceUrl] || candidate.content;
        candidate.evidencePublishedAt = candidate.sourceUrl.includes("primary") ? "2069-08-08" : candidate.publishedAt;
      }
      const full = candidates.filter((candidate) => candidate.evidenceStatus === "full").length;
      return { candidates, stats: { attempted: candidates.length, full, partial: 0, unavailable: candidates.length - full } };
    }) as any,
  });

  assert.equal(result.research.rounds.some((round) => round.stage === "verification"), true);
  assert.equal(result.research.rounds.filter((round) => round.stage === "gap-fill").length, 1, "Coverage Review 最多追加一轮 gap-fill");
  assert.match(retrievalCalls.flat().join(" "), /甲公司.*金额.*投资方|甲公司.*投资方/);
  assert.equal(result.research.supervisorAgendas.length, 3, "Coverage、gap-fill 后和取证后都应由研究主管全局复核");
  assert.equal(result.research.supervisorAgendas[0]?.coverageMap.highestValueGaps[0], "尚未覆盖的重要资本事项");
  assert.equal(result.research.supervisorAgendas[0]?.mergedClaims[0]?.duplicateClaimIds[0], "claim-5", "语义重复 claim 应由研究主管合并");
  assert.equal(result.research.verificationTraces[0]?.claimId, "claim-2", "验证预算应按主管优先级而非 claim 顺序分配");
  assert.equal(result.research.verificationTraces[0]?.highQualitySourceFound, true);
  assert.equal(result.research.verificationTraces[0]?.evidenceAcquired, true);
  assert.equal(result.research.retrievalProviderGap, false);
  assert.equal(hasRetrievalProviderGap([{ claimId: "x", priority: "critical", gaps: ["原始来源"], queries: ["求证"], topResults: [], returnedDomains: [], highQualitySourceFound: false, evidenceAcquired: false }]), true, "正确求证但检索器未返回高可信来源或正文时应标记 provider gap");
  assert.equal(result.research.verifiedClaims.length, 3);
  assert.equal(result.research.discardedClaims.some((entry) => entry.claim.statement.includes("丙公司")), true);
  assert.equal(result.importantFacts.length, 2);
  assert.equal(result.editorialBackground.some((claim) => claim.backgroundDate?.startsWith("2026-05")), true);
  assert.equal(result.importantFacts.some((item) => item.title.includes("首家")), false);
  assert.equal(result.importantFacts.some((item) => item.title.includes("4.42%")), false, "Fact 必须使用 entailment rewrite 的 supportedStatement");
  assert.deepEqual(result.research.verifiedClaims.find((claim) => claim.id === "claim-3")?.unsupportedDetails, ["股价上涨4.42%"]);
  assert.equal(result.importantFacts.some((item) => item.title.includes("劳动政策")), false);
  assert.equal(result.research.verifiedClaims.find((claim) => claim.statement.includes("80亿元"))?.supportingEvidence[0]?.url, "https://primary.example/alpha");
  assert.equal(result.research.verifiedClaims.find((claim) => claim.statement.includes("80亿元"))?.supportingEvidence[0]?.publishedAt, null, "异常未来来源日期必须归一为 null");
  assert.equal(result.sourceList.find((source) => source.url === "https://primary.example/alpha")?.publishedAt, null, "sourceList 不得输出异常未来日期");
  assert.equal(result.sourceList.some((source) => source.publishedAt?.startsWith("1970")), false, "sourceList 不得使用 epoch 默认日期");
  assert.match(result.overview, /^【资本动态】/);
  assert.doesNotMatch(result.overview, /5月的战略投资是本期新增/, "Publication Contract 必须拒绝 background 伪装成 fact");
  assert.ok(result.overview.length <= 500);
  assert.equal(result.research.rounds.every((round) => round.queryResults.every((item) => item.topResults.every((result) => !!result.title && !!result.domain))), true);
  assert.equal(result.research.rounds.find((round) => round.stage === "discovery")?.queryResults[0]?.topResults[0]?.title, "甲公司投资及融资报道");
  assert.equal(result.research.rounds.find((round) => round.stage === "gap-fill")?.queryResults[0]?.topResults[0]?.domain, "coverage.example");
  assert.equal(prompts.some((prompt) => /生成 AI Coverage Map/.test(prompt)), true);
  assert.equal(prompts.some((prompt) => /A\. 已发现 Claims 中哪些最值得验证；B\./.test(prompt)), true);
  assert.equal(prompts.some((prompt) => /Evidence Entailment Rewrite/.test(prompt)), true);
  assert.equal(prompts.some((prompt) => /relevanceToResearch=high\/medium\/low/.test(prompt)), true);

  const clue: ResearchClaim = { id: "clue-1", statement: "甲公司被报道筹划融资", eventDate: null, backgroundDate: null, entities: ["甲公司"], eventType: "融资", significance: "", confidence: "low", sourceUrls: ["https://x.example"], evidenceStatus: "unavailable", classification: "clue", relevanceToResearch: "high", supportingEvidence: [] };
  const wrongFact = renderPublicationContract([{ text: "甲公司已经完成融资。", mode: "fact", supportingClaimIds: ["clue-1"] }], [clue]);
  assert.equal(wrongFact, "", "clue 不得通过引用关系伪装成 fact");
  assert.match(renderPublicationContract([{ text: "据报道，甲公司可能筹划融资。", mode: "clue", supportingClaimIds: ["clue-1"] }], [clue]), /尚待核实/);
  const longAnalysis = "这是完整分析句。".repeat(40);
  const bounded = renderPublicationContract([
    { text: longAnalysis, mode: "analysis", supportingClaimIds: ["clue-1"] },
    { text: "第二条完整分析句。", mode: "analysis", supportingClaimIds: ["clue-1"] },
  ], [clue]);
  assert.ok(bounded.length <= 500);
  assert.ok(!bounded || bounded.endsWith("。"), "超长文本只能按完整 FinalSentence 删除，不得截断半句");
  const unsupported = enforceClaimPublicationGate({ ...clue, classification: "fact", confidence: "high", statement: "甲公司完成100亿元融资" });
  assert.equal(unsupported.classification, "clue");
  assert.equal(resolvePublishedAt({ sourcePublishedAt: "1970-01-01", url: null }).publishedAt, null);
  assert.equal(resolvePublishedAt({ sourcePublishedAt: "2069-08-08", url: null }).publishedAt, null);

  const emptyProvider: IntelligenceProvider = {
    id: "mock-empty", capabilities: { generation: true, nativeWebSearch: false },
    async generate({ system }) {
      if (system.includes("[PHASE:research-plan]")) return JSON.stringify({ understanding: "核验窗口事件", eventTypes: [], likelyEntities: [], queries: ["宽泛检索"], deepDiveCriteria: [] });
      if (system.includes("[PHASE:research-review]")) return JSON.stringify({ candidateClaims: [], followUpQueries: [], stop: true });
      if (system.includes("[PHASE:claim-atomization]")) return JSON.stringify({ claims: [] });
      if (system.includes("[PHASE:research-supervisor]")) return JSON.stringify(emptyAgenda);
      if (system.includes("[PHASE:claim-evidence-alignment]")) return JSON.stringify({ claims: [] });
      if (system.includes("[PHASE:claim-verification]")) return JSON.stringify({ claims: [] });
      throw new Error("0 claim 时不得调用最终综合");
    },
  };
  const emptyResult = await runAiFirstResearch(input, coverage, {
    generationProvider: emptyProvider,
    retrieval: { async retrieve(request) { return { status: "success", providers: [{ provider: "mock", attempted: true, succeeded: true, queryCount: request.queries?.length || 0, resultCount: 1 }], results: [{ title: "无关结果", url: "https://irrelevant.example", siteName: "来源", snippet: "无具体事件", publishedAt: null, sourceTier: "C", domain: "irrelevant.example", query: request.queries?.[0] || "" }] }; } },
    acquireEvidence: (async (candidates: any[]) => ({ candidates, stats: { attempted: 0, full: 0, partial: 0, unavailable: 0 } })) as any,
  });
  assert.equal(emptyResult.overview, "本期未发现符合条件、且可核验的新增事实。");

  let agentTurn = 0;
  let reasoningRoundTripped = false;
  const agentProvider: IntelligenceProvider = {
    id: "mock-agent",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn({ messages }) {
      agentTurn++;
      if (agentTurn === 1) return {
        content: null,
        reasoningContent: "internal reasoning must not enter telemetry",
        toolCalls: [{ id: "search-1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ queries: ["目标赛道 企业资本事项"], unresolvedGaps: ["需要发现窗口内直接资本动作"] }) } }],
      };
      reasoningRoundTripped = messages.some((message) => message.role === "assistant" && message.reasoning_content === "internal reasoning must not enter telemetry");
      if (agentTurn === 2) return {
        content: null,
        reasoningContent: "select evidence",
        toolCalls: [{ id: "read-1", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: ["https://official.example/event"], unresolvedGaps: ["核对交易日期和金额"] }) } }],
      };
      return {
        content: JSON.stringify({
          findings: [{ claim: "甲公司于8月7日完成新一轮融资", eventDate: "2026-08-07", entities: ["甲公司"], eventType: "融资", significance: "补充研发资金", sourceUrls: ["https://official.example/event"], confidence: "high" }],
          searchedAreas: ["目标赛道窗口内直接资本事项"], unresolvedGaps: [], confidence: "high",
        }),
        reasoningContent: null,
        toolCalls: [],
      };
    },
    async generate({ system }) {
      if (system.includes("[PHASE:agentic-claim-evidence-alignment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportingEvidence: [{ url: "https://official.example/event", relevantText: "甲公司于8月7日完成新一轮融资。", publishedAt: "2026-08-07" }] }] });
      if (system.includes("[PHASE:agentic-claim-verification]")) return JSON.stringify({ claims: [{ id: "claim-1", statement: "甲公司于8月7日完成新一轮融资", eventDate: "2026-08-07", entities: ["甲公司"], eventType: "融资", significance: "补充研发资金", confidence: "high", classification: "fact", relevanceToResearch: "high" }] });
      if (system.includes("[PHASE:agentic-evidence-entailment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportedStatement: "甲公司于8月7日完成新一轮融资", unsupportedDetails: [], classification: "fact" }] });
      if (system.includes("[PHASE:agentic-final-synthesis]")) return JSON.stringify({ sentences: [{ text: "甲公司于8月7日完成新一轮融资。", mode: "fact", supportingClaimIds: ["claim-1"] }, { text: "后续应关注资金用途与交割进度。", mode: "analysis", supportingClaimIds: ["claim-1"] }], items: [{ claimId: "claim-1", title: "甲公司完成新一轮融资", editorial: "后续应关注资金用途。" }], trends: [] });
      throw new Error(`unexpected agentic phase: ${system}`);
    },
  };
  const agentResult = await runAiFirstResearch(input, coverage, {
    generationProvider: agentProvider,
    retrieval: {
      async retrieve(request) {
        const query = request.queries?.[0] || "";
        return {
          status: "success" as const,
          providers: [{ provider: "mock-web", attempted: true, succeeded: true, queryCount: 1, resultCount: 1 }],
          results: [{ title: "甲公司融资公告", url: "https://official.example/event", siteName: "官方公告", snippet: "甲公司披露融资事项。", publishedAt: "2026-08-07", sourceTier: "S" as const, domain: "official.example", query }],
        };
      },
    },
    acquireEvidence: (async (candidates: any[]) => {
      candidates[0].evidenceStatus = "full";
      candidates[0].content = "甲公司于8月7日完成新一轮融资。";
      candidates[0].evidencePublishedAt = "2026-08-07";
      return { candidates, stats: { attempted: 1, full: 1, partial: 0, unavailable: 0 } };
    }) as any,
  });
  assert.equal(agentResult.research.executionMode, "agentic");
  assert.equal(agentResult.research.supervisorAgendas.length, 0, "Agentic 主链不得再由 Supervisor 状态机控制");
  assert.deepEqual(agentResult.research.agent?.turns.map((turn) => turn.action), ["web_search", "read_url", "final"]);
  assert.equal(agentResult.research.agent?.searchCalls, 1);
  assert.equal(agentResult.research.agent?.readUrls, 1);
  assert.deepEqual(agentResult.research.agent?.failureCodes, []);
  assert.equal(agentResult.importantFacts.length, 1);
  assert.equal(agentResult.importantFacts[0]?.sourceUrl, "https://official.example/event");
  assert.equal(reasoningRoundTripped, true, "thinking-mode 多轮工具调用必须回传 reasoning_content");
  assert.equal(JSON.stringify(agentResult.research.agent).includes("internal reasoning"), false, "telemetry 不得暴露 reasoning_content");

  const noSearchProvider: IntelligenceProvider = {
    id: "mock-agent-no-search",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() { return { content: JSON.stringify({ findings: [], searchedAreas: [], unresolvedGaps: ["尚未检索"], confidence: "low" }), reasoningContent: null, toolCalls: [] }; },
    async generate() { throw new Error("无 findings 时不得进入发布生成"); },
  };
  const noSearchResult = await runAiFirstResearch(input, coverage, { generationProvider: noSearchProvider, retrieval });
  assert.equal(noSearchResult.overview, "本期联网检索未成功完成，请稍后重新生成。");
  assert.deepEqual(noSearchResult.research.agent?.failureCodes, ["SEARCH_NOT_ATTEMPTED"]);

  const balancedInput = [
    ...Array.from({ length: 6 }, (_, index) => ({ title: `甲查询结果${index}`, url: `https://balance.example/a-${index}`, siteName: "来源甲", snippet: "", publishedAt: null, sourceTier: "B" as const, domain: "balance.example", query: "query-a" })),
    ...Array.from({ length: 2 }, (_, index) => ({ title: `乙查询结果${index}`, url: `https://balance.example/b-${index}`, siteName: "来源乙", snippet: "", publishedAt: null, sourceTier: "B" as const, domain: "balance.example", query: "query-b" })),
  ];
  const balanced = packAgentSearchResults(["query-a", "query-b"], balancedInput, 4);
  assert.deepEqual(balanced.map((item) => item.query), ["query-a", "query-b", "query-a", "query-b"], "多 query 结果必须 round-robin 公平装配");

  const lateUrl = "https://late.example/key-event";
  let lateTurn = 0;
  let lateUrlRead = false;
  const latePoolProvider: IntelligenceProvider = {
    id: "mock-late-pool",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      lateTurn++;
      if (lateTurn <= 4) return { content: null, reasoningContent: null, toolCalls: [{ id: `late-search-${lateTurn}`, type: "function", function: { name: "web_search", arguments: JSON.stringify({ queries: [`pool-query-${lateTurn}`] }) } }] };
      if (lateTurn === 5) return { content: null, reasoningContent: null, toolCalls: [{ id: "late-read", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: [lateUrl] }) } }] };
      return { content: JSON.stringify({ findings: [{ claim: "丁公司于8月8日完成股权融资", eventDate: "2026-08-08", entities: ["丁公司"], eventType: "股权融资", significance: "补充发展资金", sourceUrls: [lateUrl], confidence: "high" }], searchedAreas: ["窗口内资本事项"], unresolvedGaps: [], confidence: "high" }), reasoningContent: null, toolCalls: [] };
    },
    async generate({ system }) {
      if (system.includes("[PHASE:agentic-claim-evidence-alignment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportingEvidence: [{ url: lateUrl, relevantText: "丁公司于8月8日完成股权融资。", publishedAt: "2026-08-08" }] }] });
      if (system.includes("[PHASE:agentic-claim-verification]")) return JSON.stringify({ claims: [{ id: "claim-1", statement: "丁公司于8月8日完成股权融资", eventDate: "2026-08-08", entities: ["丁公司"], eventType: "股权融资", significance: "补充发展资金", confidence: "high", classification: "fact", relevanceToResearch: "high" }] });
      if (system.includes("[PHASE:agentic-evidence-entailment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportedStatement: "丁公司于8月8日完成股权融资", unsupportedDetails: [], classification: "fact" }] });
      if (system.includes("[PHASE:agentic-final-synthesis]")) return JSON.stringify({ sentences: [{ text: "丁公司于8月8日完成股权融资。", mode: "fact", supportingClaimIds: ["claim-1"] }], items: [{ claimId: "claim-1", title: "丁公司完成股权融资" }], trends: [] });
      throw new Error(`unexpected late-pool phase: ${system}`);
    },
  };
  const latePoolResult = await runAiFirstResearch(input, coverage, {
    generationProvider: latePoolProvider,
    retrieval: {
      async retrieve(request) {
        const query = request.queries?.[0] || "";
        const call = Number(query.split("-").at(-1));
        const results = Array.from({ length: 24 }, (_, index) => ({
          title: `第${call}轮结果${index}`,
          url: call === 4 && index === 0 ? lateUrl : `https://pool.example/${call}-${index}`,
          siteName: "检索来源", snippet: call === 4 && index === 0 ? "丁公司披露股权融资。" : "普通结果。", publishedAt: "2026-08-08", sourceTier: "B" as const, domain: call === 4 && index === 0 ? "late.example" : "pool.example", query,
        }));
        return { status: "success" as const, providers: [{ provider: "mock-web", attempted: true, succeeded: true, queryCount: 1, resultCount: results.length }], results };
      },
    },
    acquireEvidence: (async (candidates: any[]) => {
      lateUrlRead = candidates.some((candidate) => candidate.sourceUrl === lateUrl);
      for (const candidate of candidates) { candidate.evidenceStatus = "full"; candidate.content = "丁公司于8月8日完成股权融资。"; }
      return { candidates, stats: { attempted: candidates.length, full: candidates.length, partial: 0, unavailable: 0 } };
    }) as any,
  });
  assert.equal(lateUrlRead, true, "前三轮已累积超过60条来源后，后续关键 URL 仍必须可被 read_url 读取");
  assert.equal(latePoolResult.retrieval.searchCandidates, 96, "Agent source pool 不得复用 legacy 60 条上限");
  assert.equal(latePoolResult.importantFacts.length, 1);

  const forcedUrl = "https://forced.example/event";
  let forcedTurn = 0;
  let forcedFinalizationCalls = 0;
  const forcedProvider: IntelligenceProvider = {
    id: "mock-forced-finalization",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() {
      forcedTurn++;
      if (forcedTurn === 1) return { content: null, reasoningContent: null, toolCalls: [{ id: "forced-search", type: "function", function: { name: "web_search", arguments: JSON.stringify({ queries: ["窗口内股权事项"], unresolvedGaps: ["需要确认交易详情"] }) } }] };
      if (forcedTurn === 2) return { content: null, reasoningContent: null, toolCalls: [{ id: "forced-read", type: "function", function: { name: "read_url", arguments: JSON.stringify({ urls: [forcedUrl], unresolvedGaps: ["等待结果收口"] }) } }] };
      return { content: null, reasoningContent: null, toolCalls: [{ id: `forced-inspect-${forcedTurn}`, type: "function", function: { name: "inspect_sources", arguments: "{}" } }] };
    },
    async generate({ system }) {
      if (system.includes("[PHASE:agentic-forced-finalization]")) {
        forcedFinalizationCalls++;
        return JSON.stringify({ findings: [{ claim: "戊公司于8月8日完成战略投资", eventDate: "2026-08-08", entities: ["戊公司"], eventType: "战略投资", significance: "引入产业资本", sourceUrls: [forcedUrl], confidence: "high" }], searchedAreas: ["窗口内股权事项"], unresolvedGaps: [], confidence: "high" });
      }
      if (system.includes("[PHASE:agentic-claim-evidence-alignment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportingEvidence: [{ url: forcedUrl, relevantText: "戊公司于8月8日完成战略投资。", publishedAt: "2026-08-08" }] }] });
      if (system.includes("[PHASE:agentic-claim-verification]")) return JSON.stringify({ claims: [{ id: "claim-1", statement: "戊公司于8月8日完成战略投资", eventDate: "2026-08-08", entities: ["戊公司"], eventType: "战略投资", significance: "引入产业资本", confidence: "high", classification: "fact", relevanceToResearch: "high" }] });
      if (system.includes("[PHASE:agentic-evidence-entailment]")) return JSON.stringify({ claims: [{ id: "claim-1", supportedStatement: "戊公司于8月8日完成战略投资", unsupportedDetails: [], classification: "fact" }] });
      if (system.includes("[PHASE:agentic-final-synthesis]")) return JSON.stringify({ sentences: [{ text: "戊公司于8月8日完成战略投资。", mode: "fact", supportingClaimIds: ["claim-1"] }], items: [{ claimId: "claim-1", title: "戊公司完成战略投资" }], trends: [] });
      throw new Error(`unexpected forced phase: ${system}`);
    },
  };
  const forcedResult = await runAiFirstResearch(input, coverage, {
    generationProvider: forcedProvider,
    retrieval: { async retrieve(request) { return { status: "success", providers: [{ provider: "mock-web", attempted: true, succeeded: true, queryCount: 1, resultCount: 1 }], results: [{ title: "戊公司投资公告", url: forcedUrl, siteName: "公告来源", snippet: "戊公司披露战略投资。", publishedAt: "2026-08-08", sourceTier: "S", domain: "forced.example", query: request.queries?.[0] || "" }] }; } },
    acquireEvidence: (async (candidates: any[]) => { candidates[0].evidenceStatus = "full"; candidates[0].content = "戊公司于8月8日完成战略投资。"; return { candidates, stats: { attempted: 1, full: 1, partial: 0, unavailable: 0 } }; }) as any,
  });
  assert.equal(forcedFinalizationCalls, 1, "达到 maxAgentTurns 后必须执行一次无工具 forced finalization");
  assert.equal(forcedResult.research.claims, 1);
  assert.equal(forcedResult.importantFacts.length, 1);
  assert.equal(forcedResult.research.agent?.turns.some((turn) => turn.invalidReason === "AGENT_TURN_LIMIT"), true);
  assert.equal(forcedResult.research.agent?.unresolvedGaps.includes("需要确认交易详情"), true, "finalOutput 失败时 telemetry 仍须保留运行期 gaps");

  const failedFinalProvider: IntelligenceProvider = {
    id: "mock-finalization-failure",
    capabilities: { generation: true, nativeWebSearch: false, agenticToolUse: true },
    async runAgentTurn() { return { content: "not-json", reasoningContent: null, toolCalls: [] }; },
    async generate({ system }) { if (system.includes("[PHASE:agentic-forced-finalization]")) throw new Error("forced final unavailable"); throw new Error("publication must not run"); },
  };
  const failedFinalResult = await runAiFirstResearch(input, coverage, { generationProvider: failedFinalProvider, retrieval });
  assert.notEqual(failedFinalResult.overview, "本期未发现符合条件、且可核验的新增事实。");
  assert.equal(failedFinalResult.overview, "本期研究未能完成结果收口，请稍后重新生成。");
  assert.equal(failedFinalResult.research.agent?.failureCodes.includes("AGENT_FINALIZATION_FAILED"), true);
  assert.equal(failedFinalResult.research.agent?.turns.some((turn) => turn.invalidReason === "INVALID_FINAL_JSON"), true);
  assert.equal(failedFinalResult.research.agent?.turns.some((turn) => turn.invalidReason === "FINALIZATION_FAILED"), true);

  console.log("intelligence ai-first 05A tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
