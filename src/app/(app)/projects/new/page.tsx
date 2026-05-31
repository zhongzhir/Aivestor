"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type Phase = "idle" | "working" | "done" | "error";

export default function NewProjectPage() {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) {
      setError("仅支持 PDF 与 Word(.docx) 格式");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("文件超过 25MB，请压缩后重试");
      return;
    }
    setError("");
    setFile(f);
  }

  async function uploadDocument(pid: string): Promise<{ charCount: number }> {
    if (!file) throw new Error("未选择文件");

    setProgress(10);
    // 1. 获取预签名 URL
    const signRes = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    if (!signRes.ok) {
      const data = await signRes.json();
      throw new Error(data.error || "获取上传地址失败");
    }
    const { presignedUrl, ossUrl } = await signRes.json();

    setProgress(20);
    // 2. 浏览器直传 OSS（走 OSS 带宽，不经过服务器）
    const putRes = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) throw new Error("文件上传 OSS 失败");

    setProgress(70);
    // 3. 通知服务器解析
    const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
    const res = await fetch(`/api/projects/${pid}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl: ossUrl, filename: file.name, fileType }),
    });
    setProgress(100);

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "解析失败");
    }
    return res.json();
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("请填写项目名称");
      return;
    }
    if (!file) {
      setError("请上传 BP 文件");
      return;
    }
    setError("");
    setPhase("working");
    setProgress(0);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, companyName, industry, stage }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error || "创建项目失败");
      }
      const { id } = await res.json();
      setProjectId(id);

      const { charCount: count } = await uploadDocument(id);
      setCharCount(count);
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] 错误：", e);
      setError(msg || "操作失败，请打开浏览器控制台查看详情");
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <div className="mx-auto max-w-doc px-6 py-16">
        <h1 className="text-xl font-semibold text-ink">项目已创建</h1>
        <div className="mt-6 rounded-lg border border-line bg-accent-soft/40 p-5">
          <p className="text-sm text-ink">
            解析完成，共提取 {charCount.toLocaleString()} 字。
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            下一步：填写判断要点并生成分析报告。
          </p>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          进入项目 →
        </Link>
      </div>
    );
  }

  const busy = phase === "working";

  return (
    <div className="mx-auto max-w-doc px-6 py-12">
      <h1 className="text-xl font-semibold text-ink">新建项目分析</h1>
      <p className="mt-2 text-sm text-ink-soft">
        填写项目信息并上传 BP，系统将自动解析文本。
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-ink-soft">
            项目名称 <span className="text-red-500">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-ink-soft">公司</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-soft">行业</label>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-soft">
              融资阶段
            </label>
            <input
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={busy}
              placeholder="如 天使 / A轮"
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-ink-soft">
            BP 文件 <span className="text-red-500">*</span>
          </label>
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
              if (!busy) pickFile(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 transition-colors ${
              dragOver
                ? "border-accent bg-accent-soft/50"
                : "border-line hover:border-accent/60"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {file ? (
              <p className="text-sm text-ink">{file.name}</p>
            ) : (
              <>
                <p className="text-sm text-ink-soft">
                  点击或拖拽文件到此处上传
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  支持 PDF、Word(.docx)
                </p>
              </>
            )}
          </div>
          <div className="mt-2 text-xs leading-5 text-ink-faint">
            <p>
              支持 PDF 和 Word(.docx) 格式。请确保 PDF 中的文字可以选中复制，
              扫描件或图片型 PDF 无法提取文本。如上传失败，可尝试：
            </p>
            <ol className="mt-1 list-decimal pl-5">
              <li>用 Word 或 WPS 将文件另存为 PDF</li>
              <li>用 Adobe Acrobat 进行 OCR 识别后再上传</li>
            </ol>
            <p className="mt-1">· 文件大小请控制在 25MB 以内</p>
          </div>
        </div>

        {busy && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              {progress < 100 ? `上传中 ${progress}%` : "正在解析文档…"}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "处理中…" : "创建并解析"}
        </button>
      </div>
    </div>
  );
}
