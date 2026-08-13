"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { readError, readTextStream } from "@/lib/clientAI";
import { ExportDownloadButton } from "@/components/shared/ExportDownloadButton";

type Mode = "idle" | "generating" | "done" | "error";

export function TermSheetClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);

  async function start() {
    setMode("generating");
    setContent("");
    setError("");
    setReportId(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/term-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_input: extraInput }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "生成失败"));
      }
      const rid = res.headers.get("X-Report-Id");
      if (rid) setReportId(rid);
      await readTextStream(res, (t) => setContent((c) => c + t));
      setMode("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setMode("error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* 顶部面包屑 + 角标 */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <Link href="/projects" className="hover:text-ink-soft">
              项目分析
            </Link>
            <span>/</span>
            <Link
              href={`/projects/${projectId}`}
              className="truncate hover:text-ink-soft"
            >
              {projectName}
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              Term Sheet 初稿
            </span>
            <h1 className="text-lg font-semibold text-ink">{projectName}</h1>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            基于项目信息生成投资条款清单初稿
          </p>
        </div>
        {mode === "done" && (
          <div className="flex shrink-0 items-center gap-2">
            {reportId && (
              <ExportDownloadButton
                href={`/api/reports/${reportId}/export`}
                label="导出 Word"
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
              />
            )}
            <Link
              href={`/archive/${projectId}`}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
            >
              查看项目档案
            </Link>
          </div>
        )}
      </header>

      {/* 启动卡片 */}
      {mode === "idle" && (
        <div className="mt-8 rounded-xl border border-line bg-surface p-6">
          {/* 补充信息输入 — 仅 idle 显示 */}
          <div className="space-y-2 text-left">
            <label className="text-sm font-medium text-ink">
              补充投资条款信息{" "}
              <span className="font-normal text-ink-faint">
                （选填，填写后生成更精准）
              </span>
            </label>
            <textarea
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              placeholder={
                "例：\n拟投金额：500万元\n投前估值：3000万元\n希望获得1个董事会席位\n清算优先权：1x非参与型"
              }
              className="h-32 w-full resize-none rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-accent"
            />
            <p className="text-xs text-ink-faint">
              未填写也可直接生成；模型会把空白条款标为 [待定] 并在「信息缺口」中列出。
            </p>
          </div>

          <div className="mt-6 border-t border-line pt-5 text-center">
            <h2 className="text-base font-semibold text-ink">
              生成 Term Sheet 初稿
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              整合项目信息、财务数据、判断记录，结合投资人画像生成结构化条款清单
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              ⚠️ 本文件为 AI 辅助初稿，不构成正式法律意见，请结合专业律师审阅
            </p>
            <button
              type="button"
              onClick={start}
              className="mt-5 rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              开始生成初稿
            </button>
          </div>
        </div>
      )}

      {/* 生成中 / 完成 */}
      {(mode === "generating" || mode === "done") && (
        <article className="mt-8 rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="text-sm font-medium text-ink">{projectName}</span>
            {mode === "generating" ? (
              <span className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                正在生成…
              </span>
            ) : (
              <span className="text-xs font-medium text-accent">✓ 已存档</span>
            )}
          </div>
          <div className="report-body px-5 py-5 text-sm leading-7 text-ink">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {content}
            </ReactMarkdown>
            {mode === "generating" && <span className="type-cursor" />}
          </div>
          {mode === "done" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-xs text-ink-faint">
                已保存到项目档案 · 可导出为 Word 后进入正式审阅流程
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={start}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
                >
                  重新生成
                </button>
                {reportId && (
                  <ExportDownloadButton
                    href={`/api/reports/${reportId}/export`}
                    label="导出 Word →"
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  />
                )}
              </div>
            </div>
          )}
        </article>
      )}

      {/* 错误态 */}
      {mode === "error" && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{error || "生成失败，请重试"}</p>
          <button
            type="button"
            onClick={start}
            className="mt-4 rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
