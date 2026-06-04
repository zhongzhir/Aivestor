"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialData, FinPoint } from "@/lib/types";

const BLUE = "#1B6FE8";
const ORANGE = "#FF6B35";
const GREEN = "#3d7a5e";

const AXIS = { fontSize: 11, fill: "#787774" };
const GRID = "#e9e9e7";

type SeriesKey =
  | "revenue"
  | "ebitda"
  | "ebit"
  | "net_income"
  | "gross_margin"
  | "net_margin"
  | "headcount"
  | "customers"
  | "arr"
  | "mrr"
  | "cash"
  | "burn_rate";

const SERIES: {
  key: SeriesKey;
  title: string;
  kind: "bar" | "line" | "area";
  color: string;
}[] = [
  { key: "revenue", title: "收入", kind: "bar", color: BLUE },
  { key: "ebitda", title: "EBITDA", kind: "bar", color: BLUE },
  { key: "ebit", title: "EBIT", kind: "bar", color: BLUE },
  { key: "net_income", title: "净利润", kind: "bar", color: GREEN },
  { key: "gross_margin", title: "毛利率（%）", kind: "line", color: GREEN },
  { key: "net_margin", title: "净利率（%）", kind: "line", color: ORANGE },
  { key: "headcount", title: "员工数", kind: "bar", color: BLUE },
  { key: "customers", title: "客户数", kind: "area", color: BLUE },
  { key: "arr", title: "ARR", kind: "area", color: BLUE },
  { key: "mrr", title: "MRR", kind: "area", color: ORANGE },
  { key: "cash", title: "现金储备", kind: "area", color: "#10b981" },
  { key: "burn_rate", title: "月均消耗", kind: "bar", color: "#ef4444" },
];

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h3 className="mb-2 text-[14px] font-medium text-ink">{title}</h3>
      <div style={{ height: 200, width: "100%" }}>{children}</div>
    </div>
  );
}

function SeriesChart({
  kind,
  color,
  data,
}: {
  kind: "bar" | "line" | "area";
  color: string;
  data: FinPoint[];
}) {
  if (kind === "bar") {
    return (
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" tick={AXIS} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} axisLine={{ stroke: GRID }} width={40} />
          <Tooltip />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="value"
              position="top"
              style={{ fontSize: 11, fill: "#37352f" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (kind === "line") {
    return (
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" tick={AXIS} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} axisLine={{ stroke: GRID }} width={40} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 16, right: 12 }}>
        <defs>
          <linearGradient id={`fill-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} axisLine={{ stroke: GRID }} width={40} />
        <Tooltip />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#fill-${color})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type BannerInfo = { tone: "green" | "yellow"; text: string };

function resolveBanner(data: FinancialData): BannerInfo {
  const note = data.extraction_note ?? "";
  const points: FinPoint[] = SERIES.flatMap((s) => data[s.key] ?? []);
  const hasLow =
    points.some((p) => p.confidence === "low") ||
    (data.key_metrics ?? []).some((m) => m.confidence === "low");

  if (note.includes("Excel 直接读取")) {
    return { tone: "green", text: "数据来源：Excel 直接读取，可信度高" };
  }
  if (data.extraction_quality === "high" && !hasLow) {
    return { tone: "green", text: "数据已从文档自动提取" };
  }
  return {
    tone: "yellow",
    text: "⚠️ 部分数据由 AI 从文字描述中推断，建议与原始文件核对后使用",
  };
}

function Banner({ info, onClose }: { info: BannerInfo; onClose: () => void }) {
  const cls =
    info.tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div
      className={`mb-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${cls}`}
    >
      <span>{info.text}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭提示"
        className="shrink-0 text-sm leading-none opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

export function FinancialCharts({ data }: { data: FinancialData }) {
  const [bannerOpen, setBannerOpen] = useState(true);

  const visible = SERIES.filter((s) => (data[s.key] ?? []).length > 0);
  const metrics = data.key_metrics ?? [];
  const runway = data.runway_months ?? [];
  const hasAny =
    visible.length > 0 || metrics.length > 0 || runway.length > 0;

  if (!hasAny) {
    return (
      <div className="rounded-lg border border-dashed border-line py-12 text-center text-sm text-ink-faint">
        未在文档中发现相关财务数据
      </div>
    );
  }

  const banner = resolveBanner(data);

  return (
    <div>
      {bannerOpen && (
        <>
          <Banner info={banner} onClose={() => setBannerOpen(false)} />
          {banner.tone === "yellow" && (
            <p className="-mt-2 mb-3 text-xs text-ink-faint">
              💡 如有 Excel 财务模型，上传后可获得更精确的结构化数据
            </p>
          )}
        </>
      )}

      {data.extraction_note && (
        <p className="mb-4 text-xs leading-5 text-ink-faint">
          {data.extraction_note}
        </p>
      )}

      {/* #24 现金跑道高亮卡片 */}
      {data.runway_months && data.runway_months.length > 0 && (
        <div className="mb-3 flex items-center gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-3xl">⏳</div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-amber-700">现金跑道</div>
            <div className="text-2xl font-bold text-amber-900">
              {data.runway_months[0].value}
            </div>
            <div className="mt-0.5 text-xs text-amber-600">
              {data.runway_months[0].confidence === "high"
                ? "来源：BP 直接披露"
                : "来源：现金 / 烧钱速度推算"}
              {data.runway_months[0].note &&
                ` · ${data.runway_months[0].note}`}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((s) => (
          <ChartCard key={s.key} title={s.title}>
            <SeriesChart kind={s.kind} color={s.color} data={data[s.key]} />
          </ChartCard>
        ))}
      </div>

      {metrics.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-white p-4">
          <h3 className="mb-2 text-[14px] font-medium text-ink">关键指标</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {metrics.map((m, i) => (
              <div key={i} className="rounded-md bg-surface px-3 py-2">
                <div className="text-xs text-ink-faint">{m.label}</div>
                <div className="mt-0.5 text-sm font-medium text-ink">
                  {m.value}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  {m.year != null && <span>{m.year}</span>}
                  {m.confidence === "low" && (
                    <span className="text-amber-600">待核对</span>
                  )}
                </div>
                {m.note && (
                  <div className="mt-0.5 text-[11px] text-amber-600">
                    {m.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
