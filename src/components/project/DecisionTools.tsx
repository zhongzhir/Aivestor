"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { readTextStream, readError } from "@/lib/clientAI";

type Tool = "devil" | "outside" | "mirror";

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "devil", icon: "🔴", label: "魔鬼代言人" },
  { id: "outside", icon: "🌐", label: "行业外视角" },
  { id: "mirror", icon: "🔮", label: "历史镜像" },
];

const TOOL_DESCRIPTIONS: Record<Tool, string> = {
  devil:
    "扮演持怀疑态度的投委会成员，系统性提出质疑，帮你发现潜在风险和判断盲点。",
  outside:
    "从用户、竞争对手、监管三个非投资人视角审视项目，跳出专业视角的局限。",
  mirror:
    "基于你的历史判断记录，识别当前项目与历史案例的相似性，提供复盘参考。",
};

const STAGE_RECOMMENDATIONS: Record<string, Tool> = {
  screening: "outside",
  due_diligence: "devil",
  investment_committee: "devil",
  post_investment: "mirror",
  passed: "mirror",
  exited: "mirror",
};

interface Props {
  projectId: string;
  processStage: string;
}

export function DecisionTools({ projectId, processStage }: Props) {
  const recommended: Tool = STAGE_RECOMMENDATIONS[processStage] ?? "devil";
  const [tool, setTool] = useState<Tool>(recommended);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const res = await fetch(`/api/projects/${projectId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "分析失败"));
      }
      await readTextStream(res, (t) => setResult((c) => c + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  const hasResult = result.length > 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        选择分析工具
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {TOOLS.map((t) => {
          const active = t.id === tool;
          const isRec = t.id === recommended;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              disabled={loading}
              className={`relative rounded-md border px-4 py-2 text-sm transition-colors disabled:opacity-50 ${
                active
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-line text-ink-soft hover:bg-canvas"
              }`}
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
              {isRec && (
                <span className="ml-1.5 rounded bg-accent px-1 py-0.5 text-[10px] font-medium text-white">
                  推荐
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs leading-5 text-ink-soft">
        {TOOL_DESCRIPTIONS[tool]}
      </p>

      <button
        onClick={analyze}
        disabled={loading}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "分析中…" : hasResult ? "重新分析" : "开始分析"}
      </button>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {(loading || hasResult) && (
        <div className="mt-5 border-t border-line pt-5">
          <article className="report-body min-h-[120px]">
            {hasResult ? (
              <>
                <ReactMarkdown>{result}</ReactMarkdown>
                {loading && <span className="type-cursor" />}
              </>
            ) : (
              <p className="text-sm text-ink-faint">等待 AI 输出…</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
