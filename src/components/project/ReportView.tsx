"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { popJudgmentPoints, readTextStream, readError } from "@/lib/clientAI";
import { FinancialCharts } from "./FinancialCharts";
import { DigestCard } from "@/components/report/DigestCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { renderSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { ConfidencePanel } from "@/components/report/ConfidencePanel";
import type { FinancialData } from "@/lib/types";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 在默认 sanitize 规则基础上放行溯源徽章用到的 <span class="src-badge ...">，
// 既消毒报告中可能注入的恶意 HTML，又保留徽章样式。
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
};

interface HistoryItem {
  instruction: string;
  ts: string;
}

interface Props {
  projectId: string;
  projectName: string;
  initialReportId: string | null;
  initialContent: string;
  initialHistory: HistoryItem[];
  initialFinancialData: FinancialData | null;
  autoGenerate: boolean;
}

type Mode = "idle" | "generating" | "refining";

export function ReportView({
  projectId,
  projectName,
  initialReportId,
  initialContent,
  initialHistory,
  initialFinancialData,
  autoGenerate,
}: Props) {
  const router = useRouter();

  const [content, setContent] = useState(initialContent);
  const [reportId, setReportId] = useState(initialReportId);
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [mode, setMode] = useState<Mode>("idle");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");

  // 财务分析面板
  const [showFinancials, setShowFinancials] = useState(false);
  const [financials, setFinancials] = useState<FinancialData | null>(
    initialFinancialData
  );
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState("");

  const startedRef = useRef(false);
  const streaming = mode !== "idle";

  async function toggleFinancials() {
    if (showFinancials) {
      setShowFinancials(false);
      return;
    }
    setShowFinancials(true);
    if (financials || finLoading) return;
    setFinError("");
    setFinLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/financials`, {
        method: "POST",
        headers: JSON_HEADERS,
      });
      if (!res.ok) {
        throw new Error(await readError(res, "提取失败"));
      }
      const data = await res.json();
      setFinancials(data.financialData);
    } catch (e) {
      setFinError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setFinLoading(false);
    }
  }

  async function generate() {
    const points = popJudgmentPoints(projectId);
    if (!points || points.length < 3) {
      setError("未找到判断要点，请回到项目页重新填写并生成");
      return;
    }
    setError("");
    setMode("generating");
    setContent("");
    try {
      const res = await fetch(`/api/projects/${projectId}/reports`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ judgmentPoints: points }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "生成失败"));
      }
      const rid = res.headers.get("X-Report-Id");
      if (rid) setReportId(rid);
      await readTextStream(res, (t) => setContent((c) => c + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setMode("idle");
      // 清除 URL 上的 generate 参数，避免刷新重复生成
      router.replace(`/projects/${projectId}/report`);
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
      if (!res.ok) {
        throw new Error(await readError(res, "修改失败"));
      }
      await readTextStream(res, (t) => setContent((c) => c + t));
      setHistory((h) => [...h, { instruction: text, ts: new Date().toISOString() }]);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setMode("idle");
    }
  }

  useEffect(() => {
    if (autoGenerate && !startedRef.current) {
      startedRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      {/* 顶部：标题 + 导出 */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">
            {projectName} · 项目分析报告
          </h1>
          <p className="mt-0.5 text-xs text-ink-faint">
            {streaming
              ? mode === "generating"
                ? "正在生成…"
                : "正在修改…"
              : `共 ${history.length} 轮修改`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFinancials}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              showFinancials
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-ink-soft hover:bg-surface"
            }`}
          >
            财务分析
          </button>
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
            href={reportId ? `/api/reports/${reportId}/export-ppt` : undefined}
            aria-disabled={!reportId || streaming}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              reportId && !streaming
                ? "border-accent text-accent hover:bg-accent-soft"
                : "pointer-events-none border-line text-ink-faint opacity-50"
            }`}
          >
            导出 PPT
          </a>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 财务分析面板（可展开/收起） */}
      {showFinancials && (
        <div className="mt-5 rounded-lg bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink">财务分析</h2>
          {finLoading ? (
            <p className="py-8 text-center text-sm text-ink-faint">
              AI 正在提取财务数据…
            </p>
          ) : finError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {finError}
            </p>
          ) : financials ? (
            <FinancialCharts data={financials} />
          ) : null}
        </div>
      )}

      {/* 报告正文：先剥离置信度块，再渲染溯源徽章 */}
      {(() => {
        if (!content) {
          return (
            <article className="report-body mt-6 min-h-[200px]">
              {streaming ? (
                <p className="text-sm text-ink-faint">等待 AI 输出…</p>
              ) : (
                <EmptyState
                  icon="📄"
                  title="还没有报告"
                  description="上传文档后生成第一份分析报告"
                />
              )}
            </article>
          );
        }
        // 流式过程中保留原始内容（标记尚未完整，extractConfidence 会返回原文）
        const { confidence, cleanContent } = extractConfidence(content);
        const rendered = renderSourceBadges(cleanContent);
        return (
          <>
            <article className="report-body mt-6 min-h-[200px]">
              <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}>{rendered}</ReactMarkdown>
              {streaming && <span className="type-cursor" />}
            </article>
            {confidence && !streaming && <ConfidencePanel data={confidence} />}
            {!streaming && <SourceLegend />}
          </>
        );
      })()}

      {/* 修改历史 */}
      {history.length > 0 && (
        <div className="mt-10 border-t border-line pt-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            修改历史
          </h2>
          <ol className="mt-3 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink-soft">
                <span className="text-ink-faint">第 {i + 1} 轮</span>
                <span className="flex-1">{h.instruction}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 对话沉淀入口：对话轮次 ≥ 3 且有报告时显示 */}
      {reportId && history.length >= 3 && !streaming && (
        <DigestCard
          reportId={reportId}
          projectId={projectId}
          projectName={projectName}
          conversationLength={history.length}
        />
      )}

      {/* 修改指令输入 */}
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
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            提交修改
          </button>
        </div>
      </div>
    </div>
  );
}

// 报告溯源图例：解释正文中三种徽章的含义
function SourceLegend() {
  return (
    <div className="mt-6 rounded-lg border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">标注说明</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-doc">📄 文件依据</span>
          基于上传文件中的明确信息
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-data">✅ 数据提取</span>
          已从文件中提取的量化数据
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-ai">🤖 AI 推断</span>
          基于行业经验的判断，建议核实
        </span>
      </div>
    </div>
  );
}
