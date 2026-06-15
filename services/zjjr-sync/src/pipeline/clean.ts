// 清洗（架构文档 v1.1 第 5.4 阶段 1）。
//   - 去空白 / 全角规范化
//   - 枚举值映射（待 API 字典；当前原样保留）
//   - 日期解析失败【入 raw 不丢弃】
//
// 注意：raw 字段名待中鉴 API 文档确认（待确认清单 #1）。本模块按 fixture 的中文字段
//   键映射；HttpZjjrClient 接入后，若字段名不同，仅改本文件的取值键即可。

import type {
  ZjjrInstitutionRaw,
  ZjjrInvestmentRaw,
} from "../client";
import type { CleanInstitution, CleanInvestment } from "../types";

// 全角 → 半角 + 去首尾空白 + 折叠内部连续空白。
export function normalizeText(input: unknown): string {
  if (input == null) return "";
  let s = String(input);
  // 全角字符（含全角空格 　）转半角
  s = s.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  s = s.replace(/　/g, " ");
  return s.trim().replace(/\s+/g, " ");
}

// 去除常见机构后缀，得到规范名（消歧第二级匹配用，见 resolve.ts）。
const SUFFIX_PATTERNS = [
  /（有限合伙）$/,
  /\(有限合伙\)$/,
  /（[^）]*）$/, // 任意尾部括号注记（如「（深圳）」「（北京）」）
  /\([^)]*\)$/,
  /管理有限公司$/,
  /有限公司$/,
  /管理中心$/,
  /合伙企业$/,
  /基金$/,
];

export function canonicalize(name: string): string {
  let s = normalizeText(name);
  let changed = true;
  // 反复剥离尾部后缀，直到稳定（处理「云岭投资管理有限公司」→「云岭投资」）。
  while (changed) {
    changed = false;
    for (const p of SUFFIX_PATTERNS) {
      const next = s.replace(p, "");
      if (next !== s && next.length >= 2) {
        s = next.trim();
        changed = true;
      }
    }
  }
  return s || normalizeText(name);
}

// 解析日期为 YYYY-MM-DD；失败返回 null（原始值仍在 raw 中保留，不丢弃）。
export function parseDate(input: unknown): string | null {
  const s = normalizeText(input);
  if (!s) return null;
  // 直接 ISO / YYYY-MM-DD
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const mm = m.padStart(2, "0");
    const dd = d.padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  // 中文「2026年4月12日」
  const cn = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const [, y, m, d] = cn;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return new Date(t).toISOString().slice(0, 10);
  }
  return null; // 解析失败 —— 原文保留在 raw（调用方不会丢弃 raw）
}

function asStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((x) => normalizeText(x)).filter(Boolean);
  }
  const s = normalizeText(input);
  if (!s) return [];
  return s
    .split(/[、,，;；/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function asInt(input: unknown): number | null {
  const s = normalizeText(input).replace(/[^0-9.-]/g, "");
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function cleanInstitution(rec: ZjjrInstitutionRaw): CleanInstitution {
  const r = rec.raw;
  const name = normalizeText(r["机构名称"]);
  return {
    sourceId: rec.sourceId,
    name,
    canonicalName: canonicalize(name),
    institutionType: normalizeText(r["机构类型"]) || null,
    fundCount: asInt(r["基金数量"]),
    manageScale: normalizeText(r["管理规模"]) || null,
    focusSectors: asStringArray(r["关注赛道"]),
    focusStages: asStringArray(r["关注阶段"]),
    region: normalizeText(r["地区"]) || null,
    regStatus: normalizeText(r["登记状态"]) || null,
    raw: r,
    sourceUpdatedAt: rec.updatedAt || null,
  };
}

export function cleanInvestment(rec: ZjjrInvestmentRaw): CleanInvestment {
  const r = rec.raw;
  return {
    sourceId: rec.sourceId,
    institutionSourceId: rec.institutionSourceId,
    targetCompany: normalizeText(r["被投企业"]),
    sector: normalizeText(r["赛道"]) || null,
    stage: normalizeText(r["轮次"]) || null,
    amountText: normalizeText(r["金额"]) || null,
    investedAt: parseDate(r["投资日期"]), // 解析失败为 null，原文在 raw
    coInvestors: asStringArray(r["联合投资方"]),
    raw: r,
    sourceUpdatedAt: rec.updatedAt || null,
  };
}
