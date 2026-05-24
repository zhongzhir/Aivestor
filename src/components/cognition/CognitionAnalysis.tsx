"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { readTextStream, readError } from "@/lib/clientAI";

export function CognitionAnalysis() {
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setRunning(true);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/cognition/analyze", { method: "POST" });
      if (!res.ok) {
        throw new Error(await readError(res, "分析失败"));
      }
      await readTextStream(res, (t) => setResult((c) => c + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setRunning(false);
    }
  }

  const hasResult = result.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">AI 认知模式分析</h2>
        <button
          onClick={analyze}
          disabled={running}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {running ? "分析中…" : hasResult ? "重新分析" : "开始分析"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {(running || hasResult) && (
        <article className="report-body mt-4 min-h-[120px]">
          {hasResult ? (
            <>
              <ReactMarkdown>{result}</ReactMarkdown>
              {running && <span className="type-cursor" />}
            </>
          ) : (
            <p className="text-sm text-ink-faint">等待 AI 输出…</p>
          )}
        </article>
      )}
    </div>
  );
}
