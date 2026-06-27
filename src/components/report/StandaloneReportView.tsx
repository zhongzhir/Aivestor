"use client";

import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface Props {
  reportId: string;
  title: string;
  content: string;
  kind: string;
  updatedAt: string;
}

export function StandaloneReportView({
  reportId,
  title,
  content,
  kind: _kind,
  updatedAt,
}: Props) {
  function handleExport() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
    a.download = `${safe}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const dateStr = new Date(updatedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-xs text-ink-faint">最后更新：{dateStr}</p>
        </div>
        <button
          onClick={handleExport}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
        >
          导出 Markdown
        </button>
      </div>

      <div className="prose prose-sm max-w-none rounded-xl border border-line bg-surface p-6">
        <ReactMarkdown
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
        >
          {content || "（报告内容生成中，请稍后刷新页面）"}
        </ReactMarkdown>
      </div>
    </article>
  );
}
