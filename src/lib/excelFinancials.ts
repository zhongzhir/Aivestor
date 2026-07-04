// Excel 财务数据结构化提取：直接读取单元格数值，识别年份表头与财务术语行，
// 按 FinancialData 结构整理。Excel 数据直接读取，confidence 全部标为 "high"。

import * as XLSX from "xlsx";
import type { FinancialData, FinPoint } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

// 财务指标关键词 → FinancialData 字段。顺序重要：ebitda 须在 ebit 之前匹配。
const METRIC_KEYWORDS: { field: keyof FinancialData; pattern: RegExp }[] = [
  { field: "ebitda", pattern: /ebitda|息税折旧摊销前利润/i },
  { field: "ebit", pattern: /\bebit\b|息税前利润/i },
  { field: "gross_margin", pattern: /毛利率|gross\s*margin/i },
  { field: "net_margin", pattern: /净利率|net\s*margin/i },
  { field: "net_income", pattern: /净利润|净收入|net\s*income/i },
  { field: "revenue", pattern: /(营业)?收入|营收|revenues?|topline|销售额/i },
  { field: "headcount", pattern: /员工数?|人数|fte|headcount/i },
  { field: "customers", pattern: /客户数量?|customers/i },
  { field: "arr", pattern: /\barr\b/i },
  { field: "mrr", pattern: /\bmrr\b/i },
  // #24 新增：现金 / 烧钱速度
  { field: "cash", pattern: /现金及现金等价物|货币资金|现金储备|cash\s*and\s*cash\s*equivalents|\bcash\b/i },
  { field: "burn_rate", pattern: /月均消耗|月均烧钱|净消耗|burn\s*rate|monthly\s*burn|\bburn\b/i },
];

const POINT_FIELDS = new Set<keyof FinancialData>(
  METRIC_KEYWORDS.map((m) => m.field)
);

function matchField(label: string): keyof FinancialData | null {
  for (const { field, pattern } of METRIC_KEYWORDS) {
    if (pattern.test(label)) return field;
  }
  return null;
}

// 从单元格识别年份（如 2023、FY2024、2023年）。
function parseYear(cell: unknown): number | null {
  if (cell == null) return null;
  const s = String(cell).trim();
  const m = s.match(/(?:FY)?\s*((?:19|20)\d{2})/i);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1990 && y <= 2099) return y;
  }
  return null;
}

// 把单元格转为数值（容忍千分位、货币符、百分号）。
function parseNum(cell: unknown): number | null {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const s = String(cell).replace(/[,，%¥$\s]/g, "");
  if (s === "" || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function transpose(m: unknown[][]): unknown[][] {
  const cols = m.reduce((max, r) => Math.max(max, r ? r.length : 0), 0);
  const out: unknown[][] = [];
  for (let c = 0; c < cols; c++) {
    out.push(m.map((r) => (r ? r[c] : undefined)));
  }
  return out;
}

// 找到年份表头行：年份单元格最多（≥2）的那一行。
function findYearRow(
  matrix: unknown[][]
): { rowIdx: number; cols: Map<number, number> } | null {
  let best: { rowIdx: number; cols: Map<number, number> } | null = null;
  const limit = Math.min(matrix.length, 15);
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] || [];
    const cols = new Map<number, number>();
    for (let c = 0; c < row.length; c++) {
      const y = parseYear(row[c]);
      if (y) cols.set(c, y);
    }
    if (cols.size >= 2 && (!best || cols.size > best.cols.size)) {
      best = { rowIdx: r, cols };
    }
  }
  return best;
}

// 从一个（已使年份位于表头行的）矩阵中收集数据点。
function harvest(matrix: unknown[][]): { field: keyof FinancialData; point: FinPoint }[] {
  const header = findYearRow(matrix);
  if (!header) return [];
  const out: { field: keyof FinancialData; point: FinPoint }[] = [];
  for (let r = header.rowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    let label = "";
    for (let c = 0; c < row.length; c++) {
      if (header.cols.has(c)) continue;
      const v = row[c];
      if (v != null && String(v).trim() !== "") {
        label = String(v).trim();
        break;
      }
    }
    if (!label) continue;
    const field = matchField(label);
    if (!field) continue;
    for (const [c, year] of header.cols) {
      const num = parseNum(row[c]);
      if (num == null) continue;
      out.push({
        field,
        point: {
          year,
          value: num,
          type: year <= CURRENT_YEAR ? "actual" : "forecast",
          confidence: "high",
        },
      });
    }
  }
  return out;
}

function emptyData(): FinancialData {
  return {
    currency: "",
    unit: "",
    extraction_quality: "high",
    extraction_note: "数据来源：Excel 直接读取",
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
}

// 从 Excel buffer 提取结构化财务数据。未识别到任何数据点时返回 null。
export function extractExcelFinancials(buffer: Buffer): FinancialData | null {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const result = emptyData();
  let found = 0;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
    });
    // 同时尝试行向/列向布局，取识别数据点更多的一种
    const rowOriented = harvest(matrix);
    const colOriented = harvest(transpose(matrix));
    const chosen =
      rowOriented.length >= colOriented.length ? rowOriented : colOriented;
    for (const { field, point } of chosen) {
      if (POINT_FIELDS.has(field)) {
        (result[field] as FinPoint[]).push(point);
      }
    }
    found += chosen.length;
  }

  return found > 0 ? result : null;
}

export function serializeExcelFinancialDataForProject(
  financialData: FinancialData | null
): string | null {
  return financialData ? JSON.stringify(financialData) : null;
}
