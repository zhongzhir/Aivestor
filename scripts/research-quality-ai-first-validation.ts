import { writeFileSync } from "node:fs";
import { normalizeTaskInput } from "@/lib/intelligence";
import { createIntelligenceGenerationProvider, IntelligenceRetrievalOrchestrator } from "@/lib/intelligenceProvider";
import { runAiFirstResearch } from "@/lib/intelligenceResearchAgent";

const cases = [
  ["行业近期动态", "研究最近7天中国创新药海外 BD 与融资动态，事实摘要后给出简要投资分析。"],
  ["单一公司", "研究最近14天月之暗面的融资、产品和合作动态，区分事实与尚待确认信息。"],
  ["多来源事件", "研究最近14天中国大模型企业融资，合并同一事件的多来源报道并保留分歧。"],
  ["时间窗口", "研究最近7天商业航天资本动态，不将窗口外旧闻或回顾文章写成新增事件。"],
  ["覆盖不足", "研究最近7天中国 AI 基础设施投资动态；若来源覆盖不足，明确说明边界并给出可核实事实。"],
] as const;

function selectedCases() {
  const requested = new Set((process.env.RESEARCH_QUALITY_CASES || "").split(",").map((value) => value.trim()).filter(Boolean));
  const filtered = requested.size ? cases.filter(([name]) => requested.has(name)) : [...cases];
  if (requested.size && !filtered.length) throw new Error("RESEARCH_QUALITY_CASES did not match a known validation case");
  const maxCases = Number(process.env.RESEARCH_QUALITY_MAX_CASES || filtered.length);
  return filtered.slice(0, Number.isInteger(maxCases) && maxCases > 0 ? maxCases : filtered.length);
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.SYSTEM_DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or SYSTEM_DEEPSEEK_API_KEY is required for ECS quality validation");
  const generationProvider = createIntelligenceGenerationProvider({ provider: "deepseek", apiKey, baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" });
  const retrieval = new IntelligenceRetrievalOrchestrator([]);
  const results = [] as unknown[];
  for (const [name, instruction] of selectedCases()) {
    const startedAt = Date.now();
    console.log(`[research-quality] case_started name=${name}`);
    try {
      const input = normalizeTaskInput({ name, topics: ["AI", "创新药", "商业航天"], keywords: ["融资", "合作", "产品"], regions: ["中国"], includeRequirements: [instruction], outputInstructions: instruction, lookbackPeriod: { kind: "days", value: 14 }, maxItems: 8, executionMode: "manual", scheduleConfig: null, isActive: true });
      const research = await runAiFirstResearch(input, { start: new Date(Date.now() - 14 * 86400000), end: new Date() }, { generationProvider, retrieval });
      const durationMs = Date.now() - startedAt;
      results.push({ name, status: "completed", durationMs, retrieval: research.retrieval.status, overview: research.overview, facts: research.importantFacts.map((item) => ({ title: item.title, urls: item.sourceUrls, eventDate: item.publishedAt })), clues: research.otherItems.map((item) => ({ title: item.title, urls: item.sourceUrls })), analysis: research.importantFacts.map((item) => item.investmentNote).filter(Boolean), evidence: research.retrieval.evidence });
      console.log(`[research-quality] case_completed name=${name} duration_ms=${durationMs} retrieval=${research.retrieval.status}`);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : "unknown_error";
      results.push({ name, status: "failed", durationMs, reason });
      console.error(`[research-quality] case_failed name=${name} duration_ms=${durationMs} reason=${reason}`);
    }
  }
  const output = { generatedAt: new Date().toISOString(), sha: process.env.GIT_COMMIT || "unknown", cases: results };
  if (process.env.RESEARCH_QUALITY_OUTPUT) writeFileSync(process.env.RESEARCH_QUALITY_OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
