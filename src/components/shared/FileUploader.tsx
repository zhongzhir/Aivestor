"use client";

import { useRef, useState } from "react";

export interface UploadResult {
  fileName: string;
  status: "done" | "error";
  warning?: string;
  error?: string;
  entryId?: string;
}

interface FileUploaderProps {
  target: "project" | "knowledge";
  projectId?: string;
  category?: string;
  onUploadComplete?: (results: UploadResult[]) => void;
}

type ItemStatus = "pending" | "uploading" | "done" | "error";

interface QueueItem {
  file: File;
  status: ItemStatus;
  warning?: string;
  error?: string;
}

const MAX_FILES = 5;
const MAX_SIZE = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";
const EXT_RE = /\.(pdf|docx?|pptx?|xlsx?)$/i;

// 由文件名后缀推断统一文件类型（客户端用，与 lib/fileParser 保持一致）
function clientFileType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "pdf",
    doc: "docx",
    docx: "docx",
    ppt: "pptx",
    pptx: "pptx",
    xls: "xls",
    xlsx: "xlsx",
  };
  return map[ext || ""] || "";
}

export function FileUploader({
  target,
  projectId,
  category,
  onUploadComplete,
}: FileUploaderProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function setItem(index: number, patch: Partial<QueueItem>) {
    setQueue((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  }

  // 单个文件上传：upload-url → 解析 API
  async function uploadOne(file: File): Promise<QueueItem> {
    const blobForm = new FormData();
    blobForm.append("file", file);
    const blobRes = await fetch("/api/upload-url", {
      method: "POST",
      body: blobForm,
    });
    if (!blobRes.ok) {
      throw new Error((await blobRes.json()).error || "文件上传失败");
    }
    const { url: blobUrl } = await blobRes.json();

    let res: Response;
    if (target === "project") {
      res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          filename: file.name,
          fileType: clientFileType(file.name),
        }),
      });
    } else {
      res = await fetch("/api/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          fileName: file.name,
          fileSize: file.size,
          category,
        }),
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "解析失败");
    }
    return { file, status: "done", warning: data.warning };
  }

  async function runQueue(items: QueueItem[]) {
    setBusy(true);
    const results: UploadResult[] = [];
    for (let i = 0; i < items.length; i++) {
      setItem(i, { status: "uploading" });
      try {
        const done = await uploadOne(items[i].file);
        setItem(i, { status: "done", warning: done.warning });
        results.push({
          fileName: items[i].file.name,
          status: "done",
          warning: done.warning,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "上传失败";
        setItem(i, { status: "error", error: msg });
        results.push({
          fileName: items[i].file.name,
          status: "error",
          error: msg,
        });
      }
    }
    setBusy(false);
    onUploadComplete?.(results);
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (target === "knowledge" && !category) {
      setHint("请先选择分类");
      return;
    }
    const picked = Array.from(fileList);
    if (picked.length > MAX_FILES) {
      setHint(`单次最多上传 ${MAX_FILES} 个文件`);
      return;
    }
    const valid: QueueItem[] = [];
    for (const f of picked) {
      if (!EXT_RE.test(f.name)) {
        setHint(`不支持的格式：${f.name}`);
        return;
      }
      if (f.size > MAX_SIZE) {
        setHint(`${f.name} 超过 25MB`);
        return;
      }
      valid.push({ file: f, status: "pending" });
    }
    setHint("");
    setQueue(valid);
    runQueue(valid);
  }

  async function retry(index: number) {
    setItem(index, { status: "uploading", error: undefined });
    try {
      const done = await uploadOne(queue[index].file);
      setItem(index, { status: "done", warning: done.warning });
    } catch (e) {
      setItem(index, {
        status: "error",
        error: e instanceof Error ? e.message : "上传失败",
      });
    }
  }

  return (
    <div>
      {/* 拖拽区 */}
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center transition-colors ${
          dragOver
            ? "border-accent bg-accent-soft/50"
            : "border-line hover:border-accent/60"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <p className="text-sm text-ink-soft">拖拽文件到此处，或点击选择</p>
        <p className="mt-1 text-xs text-ink-faint">支持 PDF、Word、PPT、Excel</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          单次最多 {MAX_FILES} 个文件，每个文件最大 25MB
        </p>
      </div>

      {hint && <p className="mt-2 text-xs text-red-600">{hint}</p>}

      {/* 上传队列 */}
      {queue.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {queue.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs"
            >
              <span className="flex-1 truncate text-ink">{it.file.name}</span>
              {it.status === "uploading" && (
                <span className="text-ink-faint">解析中…</span>
              )}
              {it.status === "pending" && (
                <span className="text-ink-faint">等待中</span>
              )}
              {it.status === "done" && (
                <span className="text-accent">✅ 完成</span>
              )}
              {it.status === "error" && (
                <>
                  <span className="text-red-600">❌ 失败</span>
                  <button
                    onClick={() => retry(i)}
                    className="text-accent hover:underline"
                  >
                    重试
                  </button>
                </>
              )}
              {it.status === "done" && it.warning && (
                <span
                  className="max-w-[55%] truncate text-amber-600"
                  title={it.warning}
                >
                  ⚠️ {it.warning}
                </span>
              )}
              {it.status === "error" && it.error && (
                <span
                  className="max-w-[45%] truncate text-ink-faint"
                  title={it.error}
                >
                  {it.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
