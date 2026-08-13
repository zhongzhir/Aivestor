"use client";

import { useState } from "react";

interface Props {
  href: string;
  label: string;
  className?: string;
  disabled?: boolean;
}

function filenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
  } catch {
    return fallback;
  }
}

export function ExportDownloadButton({
  href,
  label,
  className = "",
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(href, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        let message = "导出失败，请稍后重试";
        try {
          const payload = await response.json();
          if (response.status === 401 || payload?.error === "未登录") {
            message = "当前浏览器未登录，请先登录后再导出";
          } else if (typeof payload?.error === "string") {
            message = payload.error;
          }
        } catch {
          // 使用通用提示
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromResponse(response, "Aivestor-报告.docx");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start">
      <button
        type="button"
        onClick={download}
        disabled={disabled || busy}
        aria-busy={busy}
        className={`${className} disabled:pointer-events-none disabled:opacity-50`}
      >
        {busy ? "导出中…" : label}
      </button>
      {error && (
        <span className="mt-1 max-w-56 text-[11px] leading-4 text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
