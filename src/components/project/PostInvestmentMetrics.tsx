"use client";

import { useEffect, useState } from "react";

interface Metric {
  id: string;
  metric_name: string;
  value_numeric: string;
  unit: string | null;
  period: string;
  note: string | null;
}

export function PostInvestmentMetrics({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/post-metrics`);
    if (res.ok) setMetrics((await res.json()).metrics ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function save() {
    if (!name.trim() || !value.trim() || !period.trim()) {
      setError("请填写指标名称、数值和周期");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/post-metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric_name: name, value_numeric: value, unit, period, note }),
      });
      if (!res.ok) throw new Error("指标保存失败");
      const data = await res.json();
      setMetrics((current) => [data.metric, ...current]);
      setName("");
      setValue("");
      setUnit("");
      setPeriod("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "指标保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-ink">结构化指标</h4>
          <p className="mt-1 text-xs leading-5 text-ink-faint">
            确认后的经营数据按周期保存，便于后续比较变化。
          </p>
        </div>
        <span className="text-xs text-ink-faint">{metrics.length} 条</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="指标名称" className="rounded-md border border-line px-2.5 py-2 text-xs outline-none focus:border-accent" />
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="数值" className="rounded-md border border-line px-2.5 py-2 text-xs outline-none focus:border-accent" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="单位" className="rounded-md border border-line px-2.5 py-2 text-xs outline-none focus:border-accent" />
        <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="周期，如 2026Q2" className="rounded-md border border-line px-2.5 py-2 text-xs outline-none focus:border-accent" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="口径说明（可选）" className="rounded-md border border-line px-2.5 py-2 text-xs outline-none focus:border-accent sm:col-span-3" />
        <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50">{busy ? "保存中" : "保存指标"}</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {metrics.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {metrics.slice(0, 8).map((metric) => (
            <div key={metric.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">
              <span className="font-medium text-ink">{metric.metric_name}</span>
              <span className="text-ink-soft">{metric.value_numeric}{metric.unit ? ` ${metric.unit}` : ""} · {metric.period}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
