"use client";

import { useState } from "react";

// 触发浏览器下载一个 fetch 回来的文件流。
async function downloadFromResponse(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function DataExport() {
  // System Prompt
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptErr, setPromptErr] = useState("");
  const [copied, setCopied] = useState(false);

  // 知识库快照
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapErr, setSnapErr] = useState("");

  // 完整档案
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveErr, setArchiveErr] = useState("");

  async function genSystemPrompt() {
    setPromptLoading(true);
    setPromptErr("");
    setCopied(false);
    try {
      const res = await fetch("/api/export/system-prompt", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setPromptErr(data.error || "生成失败");
      } else {
        setPromptText(data.prompt || "");
      }
    } catch {
      setPromptErr("网络异常，生成失败");
    } finally {
      setPromptLoading(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setPromptErr("复制失败，请手动选择文本复制");
    }
  }

  async function downloadSnapshot() {
    setSnapLoading(true);
    setSnapErr("");
    try {
      const res = await fetch("/api/export/knowledge-snapshot");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSnapErr(data.error || "导出失败");
        return;
      }
      await downloadFromResponse(res, `aivestor-knowledge-${todayStr()}.md`);
    } catch {
      setSnapErr("网络异常，导出失败");
    } finally {
      setSnapLoading(false);
    }
  }

  async function downloadArchive() {
    setArchiveLoading(true);
    setArchiveErr("");
    try {
      const res = await fetch("/api/export/full-archive");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setArchiveErr(data.error || "导出失败");
        return;
      }
      await downloadFromResponse(res, `aivestor-archive-${todayStr()}.docx`);
    } catch {
      setArchiveErr("网络异常，导出失败");
    } finally {
      setArchiveLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* 格式一：投资人 System Prompt */}
      <div className="rounded border border-line p-4">
        <h3 className="text-sm font-medium text-ink">我的投资 DNA</h3>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          把你的投资人画像、知识库精选与自建 SKILL 由 AI 整合压缩为一段
          2000 字以内的结构化 system prompt，可直接粘贴进 Claude Projects、
          ChatGPT、Cursor 等任何 AI 工具的 system prompt。
        </p>
        <button
          type="button"
          onClick={genSystemPrompt}
          disabled={promptLoading}
          className="mt-3 rounded bg-[#0D1B3E] px-4 py-1.5 text-xs text-white hover:bg-[#1B6FE8] disabled:opacity-50"
        >
          {promptLoading ? "AI 生成中…" : promptText ? "重新生成" : "生成投资人 DNA"}
        </button>
        {promptErr && (
          <p className="mt-2 text-xs text-red-600">{promptErr}</p>
        )}
        {promptText && (
          <div className="mt-3">
            <textarea
              readOnly
              value={promptText}
              rows={12}
              className="w-full rounded border border-line bg-canvas-soft px-3 py-2 text-xs leading-5 text-ink-soft focus:outline-none"
            />
            <button
              type="button"
              onClick={copyPrompt}
              className="mt-2 rounded border border-line px-3 py-1 text-xs text-ink-soft hover:border-ink-faint"
            >
              {copied ? "已复制 ✓" : "一键复制"}
            </button>
          </div>
        )}
      </div>

      {/* 格式二：知识库快照 */}
      <div className="rounded border border-line p-4">
        <h3 className="text-sm font-medium text-ink">知识库快照 · Markdown</h3>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          导出你全部知识库条目，按类型分组的 Markdown 文件，便于备份与迁移。
        </p>
        <button
          type="button"
          onClick={downloadSnapshot}
          disabled={snapLoading}
          className="mt-3 rounded bg-[#0D1B3E] px-4 py-1.5 text-xs text-white hover:bg-[#1B6FE8] disabled:opacity-50"
        >
          {snapLoading ? "导出中…" : "下载 Markdown 快照"}
        </button>
        {snapErr && <p className="mt-2 text-xs text-red-600">{snapErr}</p>}
      </div>

      {/* 格式三：完整投资档案 */}
      <div className="rounded border border-line p-4">
        <h3 className="text-sm font-medium text-ink">完整投资档案 · Word</h3>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          聚合投资人画像、自建 SKILL、全部知识库条目，以及项目列表与每个项目的
          投资判断，生成一份完整的 Word 档案。
        </p>
        <button
          type="button"
          onClick={downloadArchive}
          disabled={archiveLoading}
          className="mt-3 rounded bg-[#0D1B3E] px-4 py-1.5 text-xs text-white hover:bg-[#1B6FE8] disabled:opacity-50"
        >
          {archiveLoading ? "生成中…" : "下载完整档案"}
        </button>
        {archiveErr && (
          <p className="mt-2 text-xs text-red-600">{archiveErr}</p>
        )}
      </div>
    </div>
  );
}
