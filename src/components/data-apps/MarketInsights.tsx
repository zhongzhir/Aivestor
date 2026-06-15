"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

interface Insight {
  id: string;
  period: string;
  period_kind: "weekly" | "monthly";
  title: string;
  content: string;
  data_as_of: string;
  generated_at: string;
}

const DISCLAIMER =
  "数据来源：中鉴基金研究院。内容为自动生成的市场摘要，数据截止日期见各期标注，仅供内部研究参考，不构成投资建议。";

function preview(text: string, n = 200): string {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length > n ? plain.slice(0, n) + "…" : plain;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
}

// 市场洞察（架构 6.2）：纯读表渲染，列表 + 点击展开全文，零 AI 实时调用。
export default function MarketInsights() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch("/api/data-apps/market-insights")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (alive) setInsights(d.insights ?? []);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">📈 市场洞察</h1>
      <p className="mt-1 text-sm text-ink-soft">
        中鉴基金研究院数据的定期市场动态汇总
      </p>

      <div className="mt-6 space-y-3">
        {error && (
          <div className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-soft">
            加载失败，请稍后重试。
          </div>
        )}

        {!error && insights === null && (
          <div className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-faint">
            加载中…
          </div>
        )}

        {!error && insights !== null && insights.length === 0 && (
          <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
            暂无市场洞察报告，数据同步服务每周自动生成。
          </div>
        )}

        {!error &&
          insights?.map((it) => {
            const open = expanded.has(it.id);
            return (
              <div
                key={it.id}
                className="rounded-lg border border-line bg-white px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{it.title}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {it.period_kind === "weekly" ? "周报" : "月报"} ·{" "}
                      {it.period} · 生成于 {fmtTime(it.generated_at)} · 数据截止{" "}
                      {it.data_as_of}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(it.id)}
                    className="shrink-0 text-xs text-accent hover:underline"
                  >
                    {open ? "收起" : "展开全文"}
                  </button>
                </div>

                {open ? (
                  <div className="prose prose-sm mt-3 max-w-none text-ink">
                    <ReactMarkdown>{it.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-ink-soft">
                    {preview(it.content)}
                  </p>
                )}
              </div>
            );
          })}
      </div>

      <p className="mt-6 border-t border-line pt-4 text-xs text-ink-faint">
        {DISCLAIMER}
      </p>
    </div>
  );
}
