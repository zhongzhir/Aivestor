import type { ChatMessage } from "@/lib/ai";
import type { FinancialData } from "@/lib/types";
import { normalizeSourceMap, type SourceMapEntry } from "@/lib/sourceMap";
import type { DeepResearchExternalResult } from "@/lib/deepResearchExternal";

export type DeepResearchProfile = "auto" | "early_stage" | "comprehensive";
export type ResolvedDeepResearchProfile = Exclude<DeepResearchProfile, "auto">;

export interface DeepResearchMaterial {
  filename: string;
  docKind: string;
  extractedText: string;
  sourceMap?: SourceMapEntry[] | unknown;
}

export interface DeepResearchMessageInput {
  projectName: string;
  companyName?: string | null;
  industry?: string | null;
  stage?: string | null;
  requestedProfile?: DeepResearchProfile;
  judgmentPoints?: string[];
  decisionContext?: string | null;
  sourceCutoffDate?: string | null;
  materials: DeepResearchMaterial[];
  financialData?: FinancialData | null;
  externalResearch?: DeepResearchExternalResult | null;
}

const EARLY_STAGE_PATTERN =
  /种子|天使|pre[-\s]?a|pre[-\s]?b|a轮|a\+轮|b轮|seed|angel|series\s*a|series\s*b/i;

const SHARED_SYSTEM = `你是一位资深的一级股权投资研究负责人，负责把项目材料转化为可复核、可讨论、可继续尽调的深度投研底稿。

不可让渡的研究纪律：
1. 项目方材料不是事实终点。宣传性表述必须改写成可证伪命题；未取得独立证据时只能写为“公司口径待核验”。
2. 事实、公司口径、分析推断、情景假设和信息缺口必须分开表达，禁止用常识填补空白。
3. 数字先统一口径：单位、币种、期间、含税/不含税、累计/当期、历史/预测/估算。口径不清的数字不得用于强结论。
4. 意向、试点、框架协议、正式订单、交付、验收、开票、收入、回款、复购必须逐级区分，不得跨级引用。
5. 每个高优先级判断至少包含：结论、证据、成因、比较或失败案例、最强反方、敏感性、投资影响、验证动作。
6. 关键结论必须说明会改变投不投、估值、金额、条款还是时点；没有证据时降低置信度并进入尽调清单。
7. 不得声称已经完成未实际执行的公开检索、工商司法核验、客户访谈、技术测试或付费数据库查询。

溯源标记必须紧跟对应句子：
- 上传材料中的事实或主张：\`[src:doc]\`，并在句内引用材料编号，如“【M1】”。
- 从材料提取并完成口径说明的数字：\`[src:data]\`。
- 具有发布主体、日期和可追踪出处的外部/机构资料：\`[src:external]\`。
- 分析推断、机制判断或情景假设：\`[src:ai]\`。
- 缺失、无法核验或需要授权取得的信息：\`[src:gap]\`。
- 材料间口径冲突或逻辑矛盾：\`[src:inconsistent]\`。

输出简体中文 Markdown。表格应短而可读；禁止空泛扩写。最后必须输出置信度 JSON 块：
[CONFIDENCE_START]
{"overall":"高|中|低","dimensions":[{"name":"事实与证据","level":"高|中|低","note":"一句话"},{"name":"商业与市场","level":"高|中|低","note":"一句话"},{"name":"团队与组织","level":"高|中|低","note":"一句话"},{"name":"财务与回报","level":"高|中|低","note":"一句话"},{"name":"风险与决策","level":"高|中|低","note":"一句话"}],"uncertainty":"一到两句话"}
[CONFIDENCE_END]`;

const EARLY_STAGE_SYSTEM = `${SHARED_SYSTEM}

本项目使用“早期项目七项框架”。一级标题及顺序固定：
# 研究身份与边界
# 执行摘要与建议等级
# 项目事实概览与主张核验
# 一、政策
# 二、市场
# 三、团队
# 四、上下游目标
# 五、客户定位
# 六、初创投入
# 七、商业模型
# 综合研判、前置条件与触发器
# 分级尽调清单
# 来源索引与数字口径
# 重要声明与数据缺口

七项必须在执行摘要、独立章节和综合研判三处保持一致。建议等级使用：建议投资 / 有条件推进 / 暂缓 / 否决。数据不足时仍要回答该维度缺什么、影响什么判断、如何验证，不能写“信息不足故不评”。`;

const COMPREHENSIVE_SYSTEM = `${SHARED_SYSTEM}

本项目使用“成长及中后期项目16章框架”。前置身份信息和执行摘要之后，一级标题及顺序固定：
# 研究身份与边界
# 执行摘要
# 一、综合评级
# 二、公司概览
# 三、核心产品、技术与业务架构
# 四、客户、市场与商业化能力
# 五、核心团队深度分析
# 六、发展阶段与财务分析
# 七、竞争对手深度对比
# 八、第一曲线、第二曲线与路线图
# 九、行业趋势、政策导向与增量机会
# 十、核心瓶颈与风险缓释
# 十一、融资历史与机构分析
# 十二、投资价值与适配度
# 十三、组织架构、人才缺口与保障
# 十四、风险提示与补充尽调清单
# 十五、数据来源与证据分级
# 十六、重要声明与数据缺口

综合评级使用0-5分的证据锚点，不得用印象分。建议类型使用：建议投资 / 条件式投资 / 里程碑后再投 / 暂缓 / 不建议。退出至少比较 IPO、并购、老股转让、回购、S基金/接续中适用的路径；缺少投资参数时保留框架并明确缺参，不给伪精确估值或IRR。第十六章必须是最后一个业务章节。`;

function hasFinancialData(financialData?: FinancialData | null): boolean {
  if (!financialData) return false;
  return Object.entries(financialData).some(([key, value]) => {
    if (["currency", "unit", "extraction_quality", "extraction_note"].includes(key)) {
      return false;
    }
    return Array.isArray(value) && value.length > 0;
  });
}

function financialContext(financialData?: FinancialData | null): string {
  if (!financialData || !hasFinancialData(financialData)) return "（尚无结构化财务数据）";
  return JSON.stringify(financialData, null, 2);
}

function externalResearchContext(external?: DeepResearchExternalResult | null): string {
  if (!external) return "（尚未运行项目级外部取证；不得自行声称已联网核验）";
  const sourceIds = new Map(external.sources.map((source) => [source.url, source.id]));
  const findings = external.findings.map((finding, index) => [
    `### 【E${index + 1}】${finding.topic}｜${finding.status}`,
    finding.claim,
    `- 来源：${finding.sourceUrls.map((url) => `${sourceIds.get(url) || "E-S?"} ${url}`).join("；") || "无"}`,
    `- 证据说明：${finding.evidenceNote || "无"}`,
    `- 投资影响：${finding.investmentImpact || "待判断"}`,
  ].join("\n")).join("\n\n");
  const sources = external.sources.map((source) =>
    `- 【${source.id}】${source.publisher || source.domain}｜${source.title}｜${source.publishedAt || "日期未确认"}｜等级${source.sourceTier}｜${source.evidenceStatus}｜${source.url}`
  ).join("\n");
  return `${external.summary}\n\n${findings}\n\n### 外部来源索引\n${sources || "（无可用来源）"}\n\n### 未解决缺口\n${external.unresolvedGaps.map((gap) => `- ${gap}`).join("\n") || "- 无"}`;
}

export function isDeepResearchProfile(value: unknown): value is DeepResearchProfile {
  return value === "auto" || value === "early_stage" || value === "comprehensive";
}

export function resolveDeepResearchProfile(
  requested: DeepResearchProfile | undefined,
  stage?: string | null
): ResolvedDeepResearchProfile {
  if (requested && requested !== "auto") return requested;
  return EARLY_STAGE_PATTERN.test(stage || "") ? "early_stage" : "comprehensive";
}

export function buildDeepResearchMaterialContext(
  materials: DeepResearchMaterial[]
): string {
  return materials
    .map((material, index) => {
      const id = `M${index + 1}`;
      const sourceMap = normalizeSourceMap(material.sourceMap);
      const locatedText = sourceMap.length > 0
        ? sourceMap
            .map((entry) => `### 【${id}·${entry.locator}】 ${entry.label}\n${entry.text.trim()}`)
            .join("\n\n")
        : material.extractedText.trim();
      return [
        `## 【${id}】${material.filename}`,
        `- 材料类型：${material.docKind || "other"}`,
        "- 证据属性：项目方/用户上传材料，未经独立外部核验",
        `- 可回放定位：${sourceMap.length > 0 ? `${sourceMap.length}处` : "旧材料暂无细粒度定位"}`,
        "",
        locatedText,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export function buildDeepResearchMessages(
  input: DeepResearchMessageInput
): {
  system: string;
  messages: ChatMessage[];
  resolvedProfile: ResolvedDeepResearchProfile;
} {
  const resolvedProfile = resolveDeepResearchProfile(
    input.requestedProfile,
    input.stage
  );
  const judgmentPoints = (input.judgmentPoints ?? [])
    .map((point, index) => `${index + 1}. ${point}`)
    .join("\n");
  const sourceCutoffDate = input.sourceCutoffDate || new Date().toISOString().slice(0, 10);
  const userContent = `## 项目与任务
- 项目名称：${input.projectName}
- 法定主体：${input.companyName || "待唯一化核验"}
- 行业：${input.industry || "待识别"}
- 融资/发展阶段：${input.stage || "材料未明确"}
- 资料截止日：${sourceCutoffDate}
- 采用框架：${resolvedProfile === "early_stage" ? "早期项目七项框架" : "成长及中后期项目16章框架"}

## 投资人已有判断与关注点
${judgmentPoints || "（未提供；请从材料中提炼5-10条项目特异性、可证伪命题）"}

## 决策参数与机构约束
${input.decisionContext?.trim() || "（未提供；不阻塞公司与行业研究，但估值上限、投资金额、持有期、回报要求和机构红线必须列为待补参数）"}

## 结构化财务数据
${financialContext(input.financialData)}

## 项目级外部取证结果
${externalResearchContext(input.externalResearch)}

## 上传材料包
${buildDeepResearchMaterialContext(input.materials)}

## 执行要求
1. 先完成主体、时间和决策边界定锚，再形成研究命题；不要按BP页码复述。
2. 对每个关键数字列入口径或缺口；对关键主张形成“主张-证据状态-反方-投资影响-验证动作”。
3. 上传材料只能支撑[src:doc]/[src:data]；只有“项目级外部取证结果”中实际存在的E编号及URL才可标[src:external]，并在句内引用【E编号】。
4. 结论必须落到建议类型、前置条件、进入方式、退出路径和升级/维持/否决触发器。
5. 输出一份可以直接进入项目讨论、继续补证和正式导出的完整报告。`;

  const evidenceLedgerInstruction = `

## 结构化证据底稿（机器可读，必须输出）
在全部业务章节之后、置信度块之前输出以下 JSON。每个关键主张一条；引用必须使用材料上下文中实际存在的定位，例如 M1·P3、M2·SLIDE5、M3·SHEET:财务预测!A1:F20，或外部取证编号E1。没有细粒度定位的旧材料只能引用M1，不能编造页码、单元格或外部来源。
[EVIDENCE_LEDGER_START]
{"items":[{"id":"C1","claim":"关键主张","status":"document|data|external|analysis|gap|inconsistent","citations":["M1·P3"],"investmentImpact":"影响投不投、估值、金额、条款或时点","verificationAction":"下一步验证动作；已充分核验可为空","priority":"P0|P1|P2"}]}
[EVIDENCE_LEDGER_END]`;

  return {
    system:
      resolvedProfile === "early_stage"
        ? EARLY_STAGE_SYSTEM
        : COMPREHENSIVE_SYSTEM,
    messages: [{ role: "user", content: userContent + evidenceLedgerInstruction }],
    resolvedProfile,
  };
}
