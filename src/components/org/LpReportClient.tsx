"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { readTextStream, readError } from "@/lib/clientAI";
import { EmptyState } from "@/components/ui/EmptyState";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface HistoryItem {
  instruction: string;
  ts: string;
}
interface LpReport {
  id: string;
  title: string;
  content: string;
  version: number;
  conversation_history: HistoryItem[];
  created_at: string;
}

type Mode = "idle" | "generating" | "refining";

// 今天 / 90 天前的 YYYY-MM-DD（默认季度区间）。
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export function LpReportClient({
  orgName,
  investedProjects,
}: {
  orgName: string;
  investedProjects: { id: string; name: string }[];
}) {
  const [periodStart, setPeriodStart] = useState(isoDate(90));
  const [periodEnd, setPeriodEnd] = useState(isoDate(0));
  const [selected, setSelected] = useState<string[]>([]);

  const [reports, setReports] = useState<LpReport[]>([]);
  const [content, setContent] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");

  const streaming = mode !== "idle";

  async function loadList() {
    try {
      const res = await fetch("/api/org/lp-reports");
      if (res.ok) setReports((await res.json()).reports ?? []);
    } catch {
      /* 列表读取失败不阻塞主流程 */
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  function toggleProject(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function generate() {
    setError("");
    setMode("generating");
    setContent("");
    setReportId(null);
    setHistory([]);
    try {
      const res = await fetch("/api/org/lp-reports", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          periodStart,
          periodEnd,
          projectIds: selected,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "生成失败"));
      const rid = res.headers.get("X-Report-Id");
      if (rid) setReportId(rid);
      await readTextStream(res, (t) => setContent((c) => c + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setMode("idle");
      loadList();
    }
  }

  async function refine() {
    const text = instruction.trim();
    if (!text || !reportId) return;
    setError("");
    setMode("refining");
    setContent("");
    try {
      const res = await fetch(`/api/reports/${reportId}/refine`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ instruction: text }),
      });
      if (!res.ok) throw new Error(await readError(res, "修改失败"));
      await readTextStream(res, (t) => setContent((c) => c + t));
      setHistory((h) => [...h, { instruction: text, ts: new Date().toISOString() }]);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setMode("idle");
    }
  }

  function loadReport(r: LpReport) {
    setReportId(r.id);
    setContent(r.content);
    setHistory(r.conversation_history ?? []);
    setError("");
  }

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">LP 报告</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {orgName} · 选时间区间与项目范围，聚合投后数据生成报告
      </p>

      {/* 生成参数 */}
      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-ink-soft">
            报告期起
            <input
              type="date"
              value={periodStart}
              max={periodEnd}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="mt-1 block rounded border border-line px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-ink-soft">
            报告期止
            <input
              type="date"
              value={periodEnd}
              min={periodStart}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="mt-1 block rounded border border-line px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            onClick={generate}
            disabled={streaming}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {mode === "generating" ? "生成中…" : "生成报告"}
          </button>
        </div>

        {investedProjects.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-ink-faint">
              项目范围（不选 = 覆盖全部在投项目）
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {investedProjects.map((p) => {
                const active = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                      active
                        ? "border-[#0D1B3E] bg-[#0D1B3E] text-white"
                        : "border-line text-ink-soft hover:border-[#0D1B3E]"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_240px]">
        {/* 报告正文 */}
        <div>
          <div className="flex items-center justify-between border-b border-line pb-3">
            <span className="text-xs text-ink-faint">
              {streaming
                ? mode === "generating"
                  ? "正在生成…"
                  : "正在修改…"
                : reportId
                  ? `共 ${history.length} 轮修改`
                  : "未生成"}
            </span>
            <a
              href={reportId ? `/api/reports/${reportId}/export` : undefined}
              aria-disabled={!reportId || streaming}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                reportId && !streaming
                  ? "border-line text-ink-soft hover:bg-surface"
                  : "pointer-events-none border-line text-ink-faint opacity-50"
              }`}
            >
              导出 Word
            </a>
            <a
              href={
                reportId
                  ? `/api/reports/${reportId}/export?formal=1&profile=lp`
                  : undefined
              }
              aria-disabled={!reportId || streaming}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                reportId && !streaming
                  ? "border-accent bg-accent-soft text-accent hover:bg-[#f3e5dc]"
                  : "pointer-events-none border-line text-ink-faint opacity-50"
              }`}
            >
              正式版 Word
            </a>
          </div>

          {content ? (
            <article className="report-body mt-5 min-h-[200px]">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
              {streaming && <span className="type-cursor" />}
            </article>
          ) : (
            <article className="report-body mt-5 min-h-[200px]">
              {streaming ? (
                <p className="text-sm text-ink-faint">等待 AI 输出…</p>
              ) : (
                <EmptyState
                  icon="📊"
                  title="还没有 LP 报告"
                  description="设置报告期后点击「生成报告」"
                />
              )}
            </article>
          )}

          {/* 修改指令 */}
          <div className="mt-8 border-t border-line pt-5">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={streaming || !reportId}
              rows={2}
              placeholder="告诉 AI 如何修改这份报告…"
              className="w-full resize-none rounded-md border border-line px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent disabled:bg-surface"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={refine}
                disabled={streaming || !reportId || !instruction.trim()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                提交修改
              </button>
            </div>
          </div>
        </div>

        {/* 历史报告 */}
        <aside>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            历史报告
          </p>
          {reports.length === 0 ? (
            <p className="mt-3 text-xs text-ink-faint">暂无</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => loadReport(r)}
                    disabled={streaming}
                    className={`block w-full rounded border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
                      r.id === reportId
                        ? "border-[#0D1B3E] bg-blue-50 text-ink"
                        : "border-line text-ink-soft hover:bg-surface"
                    }`}
                  >
                    <span className="line-clamp-1">{r.title}</span>
                    <span className="text-ink-faint">
                      {new Date(r.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
