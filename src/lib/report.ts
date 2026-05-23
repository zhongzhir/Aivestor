import { type AIProvider, type ChatMessage, isValidProvider } from "@/lib/ai";
import { decrypt } from "@/lib/crypto";
import { query } from "@/lib/db";
import { getSystemApiKey, getFreeQuotaStatus } from "@/lib/freeQuota";
import type { FinancialData, FinPoint } from "@/lib/types";

// 报告生成 / 修改的 prompt 构建与流式响应工具。

const GENERATION_SYSTEM = `你是一位资深的一级股权投资分析师。请基于用户提供的项目 BP 内容与投资人的判断要点，撰写一份结构化的《项目分析报告》。

要求：
- 使用简体中文，专业、客观、有洞察力。
- 输出 Markdown 格式，严格包含以下七个一级标题章节，顺序固定：
  # 项目概览
  # 市场机会分析
  # 商业模式分析
  # 团队评估
  # 投资人判断
  # 风险提示
  # 初步结论
- 「项目概览」需点明公司名称、所处行业、融资阶段、核心业务。
- 「投资人判断」章节须逐条回应用户输入的判断要点，结合 BP 事实给出印证或质疑。
- 若 BP 中信息不足，明确指出「BP 未披露」，不要编造数据。
- 各章节正文用自然段落，必要时用要点列表，避免空话套话。

数据溯源标注（重要）：
在报告正文中，对以下三类信息在句末加入标注标记：

1. 有明确文件依据的结论：加 \`[src:doc]\`
2. 财务数据或可量化数据（已从文件提取）：加 \`[src:data]\`
3. AI 基于行业经验推断、无文件直接依据的判断：加 \`[src:ai]\`

标注规则：
- 每段至少标注 1-2 处，不要每句都标，只标关键结论和数据点
- 标注紧跟在对应句子末尾，标点符号之前
- 示例："该公司 2025 年 GMV 达 800 万元[src:data]，复购率表现优于同赛道平均水平[src:ai]。"
- 不要解释标注含义，直接插入标记即可

【置信度评估】
在报告正文之后，另起一行输出以下固定格式的置信度评估块（不要放在正文中间）：

[CONFIDENCE_START]
{
  "overall": "高|中|低",
  "dimensions": [
    { "name": "商业模式", "level": "高|中|低", "note": "一句话说明" },
    { "name": "团队评估", "level": "高|中|低", "note": "一句话说明" },
    { "name": "市场判断", "level": "高|中|低", "note": "一句话说明" },
    { "name": "财务数据", "level": "高|中|低", "note": "一句话说明" },
    { "name": "风险识别", "level": "高|中|低", "note": "一句话说明" }
  ],
  "uncertainty": "整体不确定性的主要来源，一到两句话"
}
[CONFIDENCE_END]

评估标准：
- 高：有充分的文件依据，结论较确定
- 中：有部分依据，但存在需核实的假设
- 低：主要基于行业经验推断，文件信息不足`;

const REFINE_SYSTEM = `你是一位资深投资分析师，正在根据用户的修改指令完善一份《项目分析报告》。

要求：
- 理解用户的自然语言修改指令，只调整相关部分，其余内容尽量保持不变。
- 返回【完整的】修改后报告（Markdown），不要只返回被修改的片段，不要附加说明文字。
- 保持原有的七章节结构与 Markdown 格式。
- 原报告中可能已有 \`[src:doc]\` / \`[src:data]\` / \`[src:ai]\` 三类溯源标注，请保留并在新增内容上沿用同一标注规则（文件依据 / 数据提取 / AI 推断）。
- 原报告末尾可能有 \`[CONFIDENCE_START]...[CONFIDENCE_END]\` 置信度评估 JSON 块。请保留该结构，并根据修改后内容【重新评估并更新】该块（不要原样照搬）。`;

const FIN_SERIES: { key: keyof FinancialData; label: string }[] = [
  { key: "revenue", label: "收入数据" },
  { key: "ebitda", label: "EBITDA" },
  { key: "ebit", label: "EBIT" },
  { key: "net_income", label: "净利润" },
  { key: "gross_margin", label: "毛利率" },
  { key: "net_margin", label: "净利率" },
  { key: "headcount", label: "员工数" },
  { key: "customers", label: "客户数" },
  { key: "arr", label: "ARR" },
  { key: "mrr", label: "MRR" },
];

// 判断 financial_data 是否含有效数据点。
function hasFinancialData(fd: FinancialData): boolean {
  return (
    FIN_SERIES.some((s) => ((fd[s.key] as FinPoint[]) ?? []).length > 0) ||
    (fd.key_metrics ?? []).length > 0
  );
}

// 把一组时间序列点格式化为 "2020年: 5.8, 2021年: 6.3（预测）"。
function formatPoints(points: FinPoint[]): string {
  return points
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((p) => {
      const tags: string[] = [];
      if (p.type === "forecast") tags.push("预测");
      if (p.confidence === "low") tags.push("置信度低");
      return `${p.year}年: ${p.value}${
        tags.length ? `（${tags.join("、")}）` : ""
      }`;
    })
    .join(", ");
}

// 将结构化财务数据格式化为注入 prompt 的上下文段落。
function formatFinancialContext(fd: FinancialData): string {
  const lines: string[] = ["【结构化财务数据】（已从文档自动提取，供参考）"];
  lines.push(`货币单位：${fd.currency || "未注明"} ${fd.unit || ""}`.trim());

  for (const s of FIN_SERIES) {
    const points = (fd[s.key] as FinPoint[]) ?? [];
    if (points.length > 0) lines.push(`${s.label}：${formatPoints(points)}`);
  }

  const km = fd.key_metrics ?? [];
  if (km.length > 0) {
    lines.push(
      `关键指标：${km
        .map(
          (m) =>
            `${m.label}: ${m.value}` +
            (m.year != null ? `（${m.year}年）` : "") +
            (m.confidence === "low" ? "（需核实）" : "")
        )
        .join("; ")}`
    );
  }

  if (fd.extraction_note) {
    lines.push(`数据置信度说明：${fd.extraction_note}`);
  }

  lines.push(
    "",
    "请在报告的财务分析章节优先使用以上结构化数据，",
    "对于标注为 forecast 的数据请注明为预测值，",
    "对于置信度 low 的数据请注明需核实。"
  );
  return lines.join("\n");
}

export function buildGenerationMessages(params: {
  projectName: string;
  companyName?: string | null;
  industry?: string | null;
  stage?: string | null;
  bpText: string;
  judgmentPoints: string[];
  financialData?: FinancialData | null;
}): { system: string; messages: ChatMessage[] } {
  const points = params.judgmentPoints
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");

  const finBlock =
    params.financialData && hasFinancialData(params.financialData)
      ? `\n\n${formatFinancialContext(params.financialData)}`
      : "";

  const userContent = `## 项目基本信息
- 项目名称：${params.projectName}
- 公司主体：${params.companyName || "（待补充）"}
- 行业：${params.industry || "（待补充）"}
- 融资阶段：${params.stage || "（待补充）"}

## 投资人判断要点
${points || "（用户未填写）"}

## 项目 BP 原文（解析自上传文档）
${params.bpText || "（未提供 BP 文本）"}${finBlock}

请据此撰写完整的项目分析报告。`;

  return {
    system: GENERATION_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  };
}

export function buildRefineMessages(params: {
  currentReport: string;
  instruction: string;
}): { system: string; messages: ChatMessage[] } {
  const userContent = `## 当前报告内容
${params.currentReport}

## 修改指令
${params.instruction}

请输出修改后的完整报告。`;

  return {
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  };
}

// 把凭据 + userId + feature 名打包成 streamChat 需要的 freeQuotaMeta；
// 仅在使用免费额度时返回非 undefined，否则返回 undefined（streamChat 跳过扣减）。
export function freeQuotaMetaFor(
  creds: UserCredentials,
  userId: string,
  feature: string
): { userId: string; feature: string } | undefined {
  if (!creds.usingFreeQuota) return undefined;
  return { userId, feature };
}

// 凭据返回的统一形状：包含可选的免费额度元信息。
// 调用方根据 usingFreeQuota 决定是否在 streamChat 里挂 freeQuotaMeta。
export interface UserCredentials {
  provider: AIProvider;
  apiKey: string;
  baseURL?: string;
  usingFreeQuota: boolean;
  tokensRemaining?: number;
}

// 从数据库读取并解密用户存储的 AI 凭据。
// 优先级：
//   1. 用户自己的 Key
//   2. 系统 Key + 手机号 + 免费额度未耗尽 → 平台代付
//   3. 都不满足 → 返回 null（调用方走原有 400 错误）
export async function loadUserAICredentials(
  userId: string
): Promise<UserCredentials | null> {
  // ai_base_url 由迁移 016 引入，旧库可能不存在 —— try/catch 兼容。
  let row: {
    api_key_encrypted: string | null;
    ai_provider: string | null;
    ai_base_url: string | null;
  } | undefined;
  try {
    const rows = await query<{
      api_key_encrypted: string | null;
      ai_provider: string | null;
      ai_base_url: string | null;
    }>(
      "SELECT api_key_encrypted, ai_provider, ai_base_url FROM users WHERE id = $1",
      [userId]
    );
    row = rows[0];
  } catch {
    const fallback = await query<{
      api_key_encrypted: string | null;
      ai_provider: string | null;
    }>("SELECT api_key_encrypted, ai_provider FROM users WHERE id = $1", [
      userId,
    ]);
    row = fallback[0]
      ? { ...fallback[0], ai_base_url: null }
      : undefined;
  }

  // 1. 用户自己的 Key
  if (row?.api_key_encrypted) {
    const provider: AIProvider =
      row.ai_provider && isValidProvider(row.ai_provider)
        ? row.ai_provider
        : "deepseek";
    try {
      return {
        provider,
        apiKey: decrypt(row.api_key_encrypted),
        baseURL: row.ai_base_url?.trim() || undefined,
        usingFreeQuota: false,
      };
    } catch {
      // 解密失败：当作没 Key，往下走免费额度兜底
    }
  }

  // 2. 系统 Key + 免费额度兜底
  const systemKey = getSystemApiKey();
  if (systemKey) {
    const quota = await getFreeQuotaStatus(userId);
    if (quota?.available) {
      return {
        provider: "deepseek",
        apiKey: systemKey,
        baseURL: "https://api.deepseek.com/v1",
        usingFreeQuota: true,
        tokensRemaining: quota.tokensRemaining,
      };
    }
  }

  return null;
}

// 把 AI 文本增量流包装为 HTTP 流式响应；流结束后执行 onComplete 持久化。
export function streamTextResponse(
  generator: AsyncGenerator<string>,
  onComplete: (fullText: string) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        await onComplete(full);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        controller.enqueue(encoder.encode(`\n\n> [生成中断] ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
