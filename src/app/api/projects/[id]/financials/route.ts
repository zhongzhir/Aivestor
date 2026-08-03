import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";
import type { FinancialData } from "@/lib/types";

export const maxDuration = 120;

const SYSTEM_PROMPT = `你是专业的财务数据提取助手，专门从投资材料中识别和提取结构化财务数据。

提取规则：
1. 优先识别文档中的表格结构，按行列提取数字
2. 文档中可能包含跨越多年的财务预测表格（如 2019、2020、2021、2022、2023、2024），
   必须逐年提取每一列的数据，不能只提取单年。例如一张 2019-2024 的 P&L 表，
   Revenue 一行应产出 6 个数据点，每年一个，遗漏任何一年都属于错误。
3. 表格在文本提取后通常表现为数字按空格或换行排列，
   第一行可能是年份，后续行是各财务指标对应的数值，
   请识别这种模式并按年份对应提取：先定位年份表头行，
   再把同一指标行的每个数字依次对应到对应年份的列。
4. 识别以下财务指标（中英文均可）：
   - 收入/Revenue/营收/Revenues/Topline
   - 净利润/Net Income/净收入
   - EBITDA/息税折旧摊销前利润
   - EBIT/息税前利润
   - 毛利率/Gross Margin
   - 净利率/Net Margin
   - 员工数/FTE/Headcount
   - 客户数/Customers
   - ARR/MRR（SaaS指标）
   - 估值/Valuation

   **现金与跑道（关键，务必提取）：**
   - cash：现金及现金等价物 / Cash and Cash Equivalents / 货币资金，按年提取
   - burn_rate：月均净消耗 / Monthly Burn Rate / 月均烧钱速度（负数），如只有年度数据则除以12换算
   - runway_months：现金跑道月数 / Runway（如 BP 中明确写"预计可支撑 X 个月"则直接提取；否则用 cash / |burn_rate| 推算）
     - runway_months 用 FinKeyMetric 格式，label="现金跑道"，value="XX个月"，year=最新年份，confidence=high（直接披露）/ low（推算值）
5. 对每个数据点，记录：数值、年份/期间、货币单位
6. 区分历史数据（actual）和预测数据（forecast）：
   如果表格列标注了 PF/forecast/projected/预测/E（如 2024E），type 标为 forecast；
   否则标为 actual
7. 如果数据来自表格，confidence 标为 "high"
   如果数据来自文字描述推断，confidence 标为 "low"，
   并在 note 字段注明"数据来自文字描述，建议核对"

输出格式严格为 JSON，结构如下：
{
  "currency": "USD/CNY/...",
  "unit": "万/百万/...",
  "extraction_quality": "high/medium/low",
  "extraction_note": "说明提取质量，如有低置信度数据请注明",
  "revenue": [{ "year": 2023, "value": 5.8, "type": "actual", "confidence": "high" }],
  "ebitda": [{ "year": 2023, "value": 0.5, "type": "actual", "confidence": "high" }],
  "ebit": [],
  "net_income": [],
  "gross_margin": [],
  "net_margin": [],
  "headcount": [{ "year": 2023, "value": 30, "type": "actual", "confidence": "high" }],
  "customers": [],
  "arr": [],
  "mrr": [],
  "cash": [{ "year": 2024, "value": 500, "type": "actual", "confidence": "high" }],
  "burn_rate": [{ "year": 2024, "value": -80, "type": "actual", "confidence": "high" }],
  "runway_months": [{ "label": "现金跑道", "value": "6个月", "year": 2024, "confidence": "low", "note": "由现金/烧钱速度推算" }],
  "valuation": [],
  "key_metrics": [{ "label": "...", "value": "...", "year": 2023, "confidence": "high", "note": "" }]
}
不输出任何 JSON 以外的内容。`;

const POINT_KEYS = [
  "revenue",
  "ebitda",
  "ebit",
  "net_income",
  "gross_margin",
  "net_margin",
  "headcount",
  "customers",
  "arr",
  "mrr",
  "cash",
  "burn_rate",
] as const;

const EMPTY: FinancialData = {
  currency: "",
  unit: "",
  extraction_quality: "low",
  extraction_note: "",
  revenue: [],
  ebitda: [],
  ebit: [],
  net_income: [],
  gross_margin: [],
  net_margin: [],
  headcount: [],
  customers: [],
  arr: [],
  mrr: [],
  cash: [],
  burn_rate: [],
  runway_months: [],
  valuation: [],
  key_metrics: [],
};

function coercePoints(v: unknown): FinancialData["revenue"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((o) => ({
      year: Number(o.year) || 0,
      value: Number(o.value) || 0,
      type: o.type === "forecast" ? ("forecast" as const) : ("actual" as const),
      confidence:
        o.confidence === "low" ? ("low" as const) : ("high" as const),
    }))
    .filter((p) => p.year > 0);
}

function coerceMetrics(v: unknown): FinancialData["key_metrics"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((o) => ({
      label: String(o.label ?? ""),
      value: String(o.value ?? ""),
      year: o.year == null ? null : Number(o.year) || null,
      confidence:
        o.confidence === "low" ? ("low" as const) : ("high" as const),
      note: String(o.note ?? ""),
    }));
}

// 从 AI 输出中提取 JSON（容忍 ```json 代码块包裹与前后噪声）。
function extractJson(text: string): FinancialData {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI 未返回有效 JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  const quality = ["high", "medium", "low"].includes(parsed.extraction_quality)
    ? parsed.extraction_quality
    : "medium";
  const result: FinancialData = {
    ...EMPTY,
    currency: typeof parsed.currency === "string" ? parsed.currency : "",
    unit: typeof parsed.unit === "string" ? parsed.unit : "",
    extraction_quality: quality,
    extraction_note:
      typeof parsed.extraction_note === "string" ? parsed.extraction_note : "",
    valuation: Array.isArray(parsed.valuation) ? parsed.valuation : [],
    key_metrics: coerceMetrics(parsed.key_metrics),
    runway_months: coerceMetrics(parsed.runway_months),
  };
  for (const key of POINT_KEYS) {
    result[key] = coercePoints(parsed[key]);
  }
  return result;
}

// POST /api/projects/[id]/financials — 从 BP 提取结构化财务数据
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "write");
  } catch (e) {
    return accessErrorResponse(e);
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  const docs = await query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM documents
      WHERE project_id = $1
        AND extracted_text IS NOT NULL
        AND doc_kind IN ('bp', 'research', 'financial_model', 'other')
      ORDER BY created_at ASC`,
    [params.id]
  );
  const bpText = docs
    .map((d) => d.extracted_text)
    .filter(Boolean)
    .join("\n\n---\n\n");
  if (!bpText) {
    return NextResponse.json(
      { error: "该项目尚未上传可解析的 BP 文档" },
      { status: 400 }
    );
  }

  // 收集完整 AI 输出
  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "financials"),
      system: await injectProfile(session.user.id, SYSTEM_PROMPT, {
        taskText: "从项目材料提取结构化财务数据，不涉及融资配置或退出期限",
      }),
      messages: [{ role: "user", content: bpText }],
    })) {
      raw += chunk;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI 调用失败";
    return NextResponse.json({ error: `财务数据提取失败：${msg}` }, {
      status: 502,
    });
  }

  let financialData: FinancialData;
  try {
    financialData = extractJson(raw);
  } catch {
    return NextResponse.json(
      { error: "AI 返回的财务数据无法解析，请重试" },
      { status: 502 }
    );
  }

  await query("UPDATE projects SET financial_data = $1 WHERE id = $2 AND deleted_at IS NULL", [
    JSON.stringify(financialData),
    params.id,
  ]);

  return NextResponse.json({ financialData });
}
