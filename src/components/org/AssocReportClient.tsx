"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { readError } from "@/lib/clientAI";

// 协会报告底稿：拉取后端聚合的 Markdown 底稿，渲染 + 导出 Word（?format=docx）。
export function AssocReportClient() {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/org/assoc-report/draft");
        if (!res.ok) throw new Error(await readError(res, "底稿生成失败"));
        setMarkdown((await res.json()).markdown ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "底稿生成失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">协会报告辅助</h1>
          <p className="mt-1 text-sm text-ink-soft">
            信息聚合底稿，辅助起草，非代报送
          </p>
        </div>
        <a
          href="/api/org/assoc-report/draft?format=docx"
          className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${
            markdown
              ? "border-line text-ink-soft hover:bg-surface"
              : "pointer-events-none border-line text-ink-faint opacity-50"
          }`}
        >
          导出 Word
        </a>
      </div>

      {/* AMBERS 报送提示 */}
      <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
        本内容为内部底稿，正式报送以 AMBERS 系统填报为准。
      </p>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-ink-faint">底稿生成中…</p>
      ) : (
        <article className="report-body mt-6 min-h-[200px]">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
