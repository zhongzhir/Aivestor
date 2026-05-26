"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { readError, readTextStream } from "@/lib/clientAI";

type Mode = "idle" | "generating" | "done" | "error";

export function BriefAnalysisClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState("");

  async function start() {
    setMode("generating");
    setContent("");
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/brief-analysis`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "生成失败"));
      }
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
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              简要分析
            </span>
            <h1 className="text-lg font-semibold text-ink">{projectName}</h1>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            快速入库评估，无需深度尽调
          </p>
        </div>
        {mode === "done" && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/archive/${projectId}`}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
            >
              查看项目档案
            </Link>
            <Link
              href={`/projects/${projectId}`}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              补充判断，升级正式分析 →
            </Link>
          </div>
        )}
      </header>

      {/* 启动卡片 */}
      {mode === "idle" && (
        <div className="mt-8 rounded-xl border border-line bg-surface p-6 text-center">
          <h2 className="text-base font-semibold text-ink">快速入库评估</h2>
          <p className="mt-2 text-sm text-ink-soft">
            基于你的投资逻辑和知识库，对项目做原则性框架评估
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            适合：明显不符合投资条件、需先存档观察、信息尚不完整的项目
          </p>
          <ul className="mt-5 space-y-1.5 text-left text-xs text-ink-soft">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-accent">✓</span>
              无需填写 3 条以上判断，随时可开始
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-accent">✓</span>
              调用你的知识库与画像，输出有针对性
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-accent">✓</span>
              结果自动存档，可随时追加信息升级为正式分析
            </li>
          </ul>
          <button
            type="button"
            onClick={start}
            className="mt-6 rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            开始简要分析
          </button>
        </div>
      )}

      {/* 生成中 / 完成：报告内容 */}
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
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
              {content}
            </ReactMarkdown>
            {mode === "generating" && <span className="type-cursor" />}
          </div>
          {mode === "done" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-xs text-ink-faint">
                已保存到项目档案 · 追加材料或判断后可生成正式分析
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={start}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
                >
                  重新生成
                </button>
                <Link
                  href={`/projects/${projectId}`}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  补充判断 →
                </Link>
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
