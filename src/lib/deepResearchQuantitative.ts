import type { FinKeyMetric, FinPoint, FinancialData } from "@/lib/types";

export type QuantitativeStatus = "ready" | "partial" | "blocked";
export type QuantitativeMetricStatus = "computed" | "reported" | "blocked";

export interface QuantitativeSource {
  kind: "file" | "user" | "external" | "derived";
  ref: string;
  traceable: boolean;
}

export interface QuantitativeInput {
  id: string;
  label: string;
  value: number | string;
  displayValue: string;
  period: number | null;
  source: QuantitativeSource;
}

export interface QuantitativeMetric {
  id: string;
  label: string;
  status: QuantitativeMetricStatus;
  displayValue: string;
  formula: string | null;
  inputIds: string[];
  sourceRefs: string[];
  note: string;
}

export interface QuantitativeScenario {
  id: "downside" | "base" | "upside";
  label: string;
  status: "computed" | "blocked";
  investmentAmount: number | null;
  preMoneyValuation: number | null;
  postMoneyValuation: number | null;
  ownership: number | null;
  holdingYears: number | null;
  exitEquityValue: number | null;
  proceeds: number | null;
  moic: number | null;
  irr: number | null;
  missingInputs: string[];
  sourceRefs: string[];
}

export interface DeepResearchQuantitativeAnalysis {
  version: 1;
  status: QuantitativeStatus;
  currency: string;
  financialUnit: string;
  inputs: QuantitativeInput[];
  metrics: QuantitativeMetric[];
  scenarios: QuantitativeScenario[];
  blockers: string[];
  warnings: string[];
}

interface ParsedDecisionNumber {
  value: number;
  source: QuantitativeSource;
}

const MONEY_SCALE: Record<string, number> = {
  元: 1,
  万: 10_000,
  万元: 10_000,
  亿: 100_000_000,
  亿元: 100_000_000,
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatMoney(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${formatNumber(value / 100_000_000)}亿元`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(value / 10_000)}万元`;
  return `${formatNumber(value)}元`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

function decisionLines(value?: string | null): string[] {
  return (value || "")
    .split(/[\n；;]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sourceForDecisionLine(line: string): QuantitativeSource {
  const url = line.match(/https?:\/\/[^\s）)]+/i)?.[0];
  return url
    ? { kind: "external", ref: url, traceable: true }
    : { kind: "user", ref: "用户决策参数", traceable: true };
}

function parseMoneyLine(line: string, sourceLine = line): ParsedDecisionNumber | null {
  const match = line.match(/(-?\d+(?:\.\d+)?)\s*(亿元|亿|万元|万|元)/);
  if (!match) return null;
  const value = Number(match[1]) * MONEY_SCALE[match[2]];
  return finite(value) ? { value, source: sourceForDecisionLine(sourceLine) } : null;
}

function findMoney(lines: string[], patterns: RegExp[]): ParsedDecisionNumber | null {
  for (const pattern of patterns) {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) continue;
    const match = line.match(pattern);
    const remainder = match?.index != null
      ? line.slice(match.index + match[0].length)
      : line;
    const parsed = parseMoneyLine(remainder, line) ?? parseMoneyLine(line);
    if (parsed) return parsed;
  }
  return null;
}

function findYears(lines: string[]): ParsedDecisionNumber | null {
  const line = lines.find((candidate) => /持有期|持有年限|退出周期|投资期限/.test(candidate));
  if (!line) return null;
  const label = line.match(/持有期|持有年限|退出周期|投资期限/);
  const match = line.slice((label?.index ?? 0) + (label?.[0].length ?? 0))
    .match(/(\d+(?:\.\d+)?)\s*年/);
  if (!match) return null;
  const value = Number(match[1]);
  return finite(value) && value > 0
    ? { value, source: sourceForDecisionLine(line) }
    : null;
}

function pointSource(point: FinPoint, financialData: FinancialData): QuantitativeSource {
  if (point.source?.locator) {
    return { kind: "file", ref: point.source.locator, traceable: true };
  }
  return {
    kind: "file",
    ref: financialData.extraction_note || "结构化财务数据（原始定位待补）",
    traceable: false,
  };
}

function metricSource(metric: FinKeyMetric, financialData: FinancialData): QuantitativeSource {
  if (metric.source?.locator) {
    return { kind: "file", ref: metric.source.locator, traceable: true };
  }
  return {
    kind: "file",
    ref: financialData.extraction_note || metric.note || "结构化财务数据（原始定位待补）",
    traceable: false,
  };
}

function sorted(points: FinPoint[]): FinPoint[] {
  return [...points].filter((point) => finite(point.value)).sort((a, b) => a.year - b.year);
}

function pointAtYear(points: FinPoint[], year: number): FinPoint | undefined {
  return points.find((point) => point.year === year);
}

function numericMetricValue(metric: FinKeyMetric | undefined): number | null {
  if (!metric) return null;
  const match = metric.value.replace(/[,，]/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function buildDeepResearchQuantitativeAnalysis(input: {
  financialData?: FinancialData | null;
  decisionContext?: string | null;
}): DeepResearchQuantitativeAnalysis {
  const financialData = input.financialData ?? null;
  const lines = decisionLines(input.decisionContext);
  const inputs: QuantitativeInput[] = [];
  const metrics: QuantitativeMetric[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const addInput = (value: QuantitativeInput) => {
    if (!inputs.some((item) => item.id === value.id)) inputs.push(value);
  };
  const addPointInput = (id: string, label: string, point: FinPoint) => {
    const source = pointSource(point, financialData!);
    addInput({
      id,
      label,
      value: point.value,
      displayValue: `${formatNumber(point.value)} ${financialData?.unit || "单位待确认"}`,
      period: point.year,
      source,
    });
    return source;
  };

  if (financialData) {
    const revenue = sorted(financialData.revenue);
    const actualRevenue = revenue.filter((point) => point.type === "actual");
    if (actualRevenue.length >= 2) {
      const previous = actualRevenue.at(-2)!;
      const current = actualRevenue.at(-1)!;
      const previousSource = addPointInput(`revenue_${previous.year}`, `${previous.year}年收入`, previous);
      const currentSource = addPointInput(`revenue_${current.year}`, `${current.year}年收入`, current);
      if (previous.value !== 0) {
        const growth = current.value / previous.value - 1;
        metrics.push({
          id: "latest_actual_revenue_growth",
          label: "最近实际收入增速",
          status: "computed",
          displayValue: formatPercent(growth),
          formula: `${current.year}收入 ÷ ${previous.year}收入 - 1`,
          inputIds: [`revenue_${previous.year}`, `revenue_${current.year}`],
          sourceRefs: unique([previousSource.ref, currentSource.ref]),
          note: "仅比较项目结构化数据中的相邻实际年度。",
        });
      }
    }

    const lastActual = actualRevenue.at(-1);
    const lastForecast = revenue.filter((point) => point.type === "forecast").at(-1);
    if (lastActual && lastForecast && lastForecast.year > lastActual.year && lastActual.value > 0 && lastForecast.value > 0) {
      const actualSource = addPointInput(`revenue_${lastActual.year}`, `${lastActual.year}年收入`, lastActual);
      const forecastSource = addPointInput(`revenue_${lastForecast.year}`, `${lastForecast.year}年收入`, lastForecast);
      const years = lastForecast.year - lastActual.year;
      const cagr = Math.pow(lastForecast.value / lastActual.value, 1 / years) - 1;
      metrics.push({
        id: "forecast_revenue_cagr",
        label: "收入预测复合增速",
        status: "computed",
        displayValue: formatPercent(cagr),
        formula: `(${lastForecast.year}收入 ÷ ${lastActual.year}收入)^(1/${years}) - 1`,
        inputIds: [`revenue_${lastActual.year}`, `revenue_${lastForecast.year}`],
        sourceRefs: unique([actualSource.ref, forecastSource.ref]),
        note: "预测结果取决于项目方预测口径，不等同已实现增长。",
      });
    }

    for (const [key, label] of [
      ["gross_margin", "最近毛利率"],
      ["net_margin", "最近净利率"],
    ] as const) {
      const point = sorted(financialData[key]).at(-1);
      if (!point) continue;
      const source = addPointInput(`${key}_${point.year}`, `${point.year}年${label}`, point);
      const normalized = Math.abs(point.value) > 1 ? point.value / 100 : point.value;
      metrics.push({
        id: `latest_${key}`,
        label,
        status: "computed",
        displayValue: formatPercent(normalized),
        formula: null,
        inputIds: [`${key}_${point.year}`],
        sourceRefs: [source.ref],
        note: point.type === "forecast" ? "来自预测期数据。" : "来自实际期数据。",
      });
    }

    if (!financialData.net_margin.length) {
      const income = sorted(financialData.net_income).at(-1);
      const revenuePoint = income ? pointAtYear(revenue, income.year) : undefined;
      if (income && revenuePoint && revenuePoint.value !== 0) {
        const incomeSource = addPointInput(`net_income_${income.year}`, `${income.year}年净利润`, income);
        const revenueSource = addPointInput(`revenue_${revenuePoint.year}`, `${revenuePoint.year}年收入`, revenuePoint);
        metrics.push({
          id: "derived_net_margin",
          label: "最近净利率",
          status: "computed",
          displayValue: formatPercent(income.value / revenuePoint.value),
          formula: "净利润 ÷ 收入",
          inputIds: [`net_income_${income.year}`, `revenue_${revenuePoint.year}`],
          sourceRefs: unique([incomeSource.ref, revenueSource.ref]),
          note: "由同年度净利润和收入计算。",
        });
      }
    }

    const explicitRunway = financialData.runway_months.at(-1);
    const explicitRunwayValue = numericMetricValue(explicitRunway);
    if (explicitRunway && finite(explicitRunwayValue)) {
      const source = metricSource(explicitRunway, financialData);
      addInput({
        id: "runway_explicit",
        label: "现金跑道",
        value: explicitRunwayValue,
        displayValue: `${formatNumber(explicitRunwayValue, 1)}个月`,
        period: explicitRunway.year,
        source,
      });
      metrics.push({
        id: "cash_runway",
        label: "现金跑道",
        status: "reported",
        displayValue: `${formatNumber(explicitRunwayValue, 1)}个月`,
        formula: null,
        inputIds: ["runway_explicit"],
        sourceRefs: [source.ref],
        note: "采用材料明确披露值。",
      });
    } else {
      const cash = sorted(financialData.cash).at(-1);
      const burn = sorted(financialData.burn_rate).at(-1);
      if (cash && burn && Math.abs(burn.value) > 0) {
        const cashSource = addPointInput(`cash_${cash.year}`, `${cash.year}年现金`, cash);
        const burnSource = addPointInput(`burn_${burn.year}`, `${burn.year}年月均净消耗`, burn);
        metrics.push({
          id: "cash_runway",
          label: "现金跑道",
          status: "computed",
          displayValue: `${formatNumber(cash.value / Math.abs(burn.value), 1)}个月`,
          formula: "现金及现金等价物 ÷ 月均净消耗绝对值",
          inputIds: [`cash_${cash.year}`, `burn_${burn.year}`],
          sourceRefs: unique([cashSource.ref, burnSource.ref]),
          note: cash.year === burn.year ? "使用同年度口径。" : "现金与净消耗期间不同，需人工复核。",
        });
        if (cash.year !== burn.year) warnings.push("现金与月均净消耗期间不同，现金跑道需人工复核。");
      }
    }

    const netIncome = sorted(financialData.net_income);
    const breakEven = netIncome.find((point, index) =>
      point.value >= 0 && netIncome.slice(0, index).some((previous) => previous.value < 0)
    );
    if (breakEven) {
      const previousNegative = [...netIncome]
        .reverse()
        .find((point) => point.year < breakEven.year && point.value < 0)!;
      const negativeSource = addPointInput(`net_income_${previousNegative.year}`, `${previousNegative.year}年净利润`, previousNegative);
      const breakEvenSource = addPointInput(`net_income_${breakEven.year}`, `${breakEven.year}年净利润`, breakEven);
      metrics.push({
        id: "break_even_year",
        label: "账面盈亏平衡年份",
        status: "computed",
        displayValue: `${breakEven.year}年${breakEven.type === "forecast" ? "（预测）" : ""}`,
        formula: "所提供序列中净利润由负转为非负的首年",
        inputIds: [`net_income_${previousNegative.year}`, `net_income_${breakEven.year}`],
        sourceRefs: unique([negativeSource.ref, breakEvenSource.ref]),
        note: "仅基于已提供净利润序列，不替代现金盈亏平衡分析。",
      });
    }

    const latestRevenue = revenue.at(-1);
    if (latestRevenue) {
      for (const [field, id, label, divisorLabel] of [
        [financialData.customers, "revenue_per_customer", "单客户收入", "客户数"],
        [financialData.headcount, "revenue_per_employee", "人均收入", "员工数"],
      ] as const) {
        const divisor = pointAtYear(field, latestRevenue.year);
        if (!divisor || divisor.value <= 0) continue;
        const revenueSource = addPointInput(`revenue_${latestRevenue.year}`, `${latestRevenue.year}年收入`, latestRevenue);
        const divisorSource = addPointInput(`${id}_divisor_${divisor.year}`, `${divisor.year}年${divisorLabel}`, divisor);
        metrics.push({
          id,
          label,
          status: "computed",
          displayValue: `${formatNumber(latestRevenue.value / divisor.value)} ${financialData.unit || "收入单位待确认"}`,
          formula: `收入 ÷ ${divisorLabel}`,
          inputIds: [`revenue_${latestRevenue.year}`, `${id}_divisor_${divisor.year}`],
          sourceRefs: unique([revenueSource.ref, divisorSource.ref]),
          note: "按同年度结构化数据计算。",
        });
      }
    }

    for (const marker of ["TAM", "SAM", "SOM"] as const) {
      const item = financialData.key_metrics.find((metric) =>
        new RegExp(`(?:^|[^A-Z])${marker}(?:[^A-Z]|$)|${marker === "TAM" ? "总可寻址市场" : marker === "SAM" ? "可服务市场" : "可获得市场"}`, "i")
          .test(metric.label)
      );
      if (!item) continue;
      const source = metricSource(item, financialData);
      addInput({
        id: marker.toLowerCase(),
        label: marker,
        value: item.value,
        displayValue: item.value,
        period: item.year,
        source,
      });
      metrics.push({
        id: marker.toLowerCase(),
        label: marker,
        status: "reported",
        displayValue: item.value,
        formula: null,
        inputIds: [marker.toLowerCase()],
        sourceRefs: [source.ref],
        note: "沿用材料披露口径，未自动推导市场规模。",
      });
    }

    if (!financialData.currency || !financialData.unit) {
      warnings.push("财务数据币种或金额单位未明确，跨金额口径的估值倍数测算已停步。");
    }
  } else {
    blockers.push("缺少结构化财务数据，无法计算增长、利润率、单位经济、现金跑道和盈亏平衡。");
  }

  const investment = findMoney(lines, [/拟投金额|投资金额|投资额|拟投资|本轮投资/]);
  const preMoney = findMoney(lines, [/投前估值|pre[-\s]?money/i]);
  const postMoney = findMoney(lines, [/投后估值|post[-\s]?money/i]);
  const holdingYears = findYears(lines);
  const scenarioValues: Record<QuantitativeScenario["id"], ParsedDecisionNumber | null> = {
    downside: findMoney(lines, [/悲观.*(?:退出估值|退出时估值|估值)/, /(?:退出估值|退出时估值).*悲观/]),
    base: findMoney(lines, [/基准.*(?:退出估值|退出时估值|估值)/, /(?:退出估值|退出时估值).*基准/, /^(?!.*(?:悲观|乐观)).*(?:退出估值|退出时估值)/]),
    upside: findMoney(lines, [/乐观.*(?:退出估值|退出时估值|估值)/, /(?:退出估值|退出时估值).*乐观/]),
  };

  const addDecisionInput = (id: string, label: string, value: ParsedDecisionNumber | null) => {
    if (!value) return;
    addInput({
      id,
      label,
      value: value.value,
      displayValue: id === "holding_years" ? `${formatNumber(value.value, 1)}年` : formatMoney(value.value),
      period: null,
      source: value.source,
    });
  };
  addDecisionInput("investment_amount", "拟投资金额", investment);
  addDecisionInput("pre_money_valuation", "投前估值", preMoney);
  addDecisionInput("post_money_valuation", "投后估值", postMoney);
  addDecisionInput("holding_years", "持有期", holdingYears);
  for (const [id, value] of Object.entries(scenarioValues) as Array<[QuantitativeScenario["id"], ParsedDecisionNumber | null]>) {
    addDecisionInput(`exit_${id}`, `${id === "downside" ? "悲观" : id === "base" ? "基准" : "乐观"}退出估值`, value);
  }

  if (preMoney && postMoney && investment) {
    const expected = preMoney.value + investment.value;
    if (expected > 0 && Math.abs(postMoney.value - expected) / expected > 0.01) {
      warnings.push("投前估值、投资金额与投后估值不一致，回报测算按投前估值加投资金额计算。");
    }
  }

  const scenarios: QuantitativeScenario[] = ([
    ["downside", "悲观情景"],
    ["base", "基准情景"],
    ["upside", "乐观情景"],
  ] as const).map(([id, label]) => {
    const missingInputs: string[] = [];
    if (!investment || investment.value <= 0) missingInputs.push("拟投资金额");
    if ((!preMoney || preMoney.value <= 0) && (!postMoney || postMoney.value <= 0)) {
      missingInputs.push("投前估值或投后估值");
    }
    if (!holdingYears || holdingYears.value <= 0) missingInputs.push("持有期");
    const exit = scenarioValues[id];
    if (!exit || exit.value <= 0) missingInputs.push(`${label}退出估值`);

    const effectivePostMoney = preMoney && investment
      ? preMoney.value + investment.value
      : postMoney?.value ?? null;
    const ownership = investment && effectivePostMoney && effectivePostMoney > 0
      ? investment.value / effectivePostMoney
      : null;
    const proceeds = ownership != null && exit ? ownership * exit.value : null;
    const moic = proceeds != null && investment && investment.value > 0
      ? proceeds / investment.value
      : null;
    const irr = moic != null && moic > 0 && holdingYears && holdingYears.value > 0
      ? Math.pow(moic, 1 / holdingYears.value) - 1
      : null;
    const sourceRefs = unique([
      investment?.source.ref,
      preMoney?.source.ref,
      postMoney?.source.ref,
      holdingYears?.source.ref,
      exit?.source.ref,
    ].filter((value): value is string => Boolean(value)));

    return {
      id,
      label,
      status: missingInputs.length === 0 && ownership != null && moic != null && irr != null
        ? "computed"
        : "blocked",
      investmentAmount: investment?.value ?? null,
      preMoneyValuation: preMoney?.value ?? null,
      postMoneyValuation: effectivePostMoney,
      ownership,
      holdingYears: holdingYears?.value ?? null,
      exitEquityValue: exit?.value ?? null,
      proceeds,
      moic,
      irr,
      missingInputs,
      sourceRefs,
    };
  });

  const completeScenarios = scenarios.filter((scenario) => scenario.status === "computed");
  if (completeScenarios.length < 3) {
    blockers.push(...unique(scenarios.flatMap((scenario) => scenario.missingInputs))
      .map((missing) => `回报情景缺少${missing}。`));
  }
  if (inputs.some((item) => item.source.kind === "file" && !item.source.traceable)) {
    warnings.push("部分财务数据未保留原始单元格或文件定位，计算可复现但来源需人工回补。");
  }
  const hasFinancialMetric = metrics.some((metric) => metric.status !== "blocked");
  const status: QuantitativeStatus = completeScenarios.length === 3 && hasFinancialMetric
    ? "ready"
    : hasFinancialMetric || completeScenarios.length > 0
      ? "partial"
      : "blocked";

  return {
    version: 1,
    status,
    currency: financialData?.currency || "待确认",
    financialUnit: financialData?.unit || "待确认",
    inputs,
    metrics,
    scenarios,
    blockers: unique(blockers),
    warnings: unique(warnings),
  };
}

export function quantitativeAnalysisPromptBlock(
  analysis: DeepResearchQuantitativeAnalysis
): string {
  const metricLines = analysis.metrics.map((metric) =>
    `- ${metric.label}：${metric.displayValue}；状态=${metric.status}；公式=${metric.formula || "材料披露"}；来源=${metric.sourceRefs.join("、") || "待补"}；说明=${metric.note}`
  );
  const scenarioLines = analysis.scenarios.map((scenario) =>
    scenario.status === "computed"
      ? `- ${scenario.label}：持股${formatPercent(scenario.ownership!)}，回收${formatMoney(scenario.proceeds!)}，MOIC ${formatNumber(scenario.moic!)}x，IRR ${formatPercent(scenario.irr!)}；来源=${scenario.sourceRefs.join("、")}`
      : `- ${scenario.label}：停止测算；缺少${scenario.missingInputs.join("、")}`
  );
  return [
    `量化状态：${analysis.status}`,
    `币种/财务单位：${analysis.currency}/${analysis.financialUnit}`,
    "确定性指标：",
    ...(metricLines.length ? metricLines : ["- 暂无可计算指标"]),
    "回报情景：",
    ...scenarioLines,
    "阻断项：",
    ...(analysis.blockers.length ? analysis.blockers.map((item) => `- ${item}`) : ["- 无"]),
    "复核提示：",
    ...(analysis.warnings.length ? analysis.warnings.map((item) => `- ${item}`) : ["- 无"]),
    "纪律：只能引用以上已计算结果；blocked 项不得补猜、外推或生成伪精确数字。",
  ].join("\n");
}
