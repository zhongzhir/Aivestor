"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatTokens } from "@/lib/tokensFormat";

// idle → working（创建+上传解析）→ confirm_images（BP 检测到图片，等待确认）
//   → analyzing（Qwen-VL 识别中）→ done；任意环节出错落入 error
type Phase =
  | "idle"
  | "working"
  | "confirm_images"
  | "analyzing"
  | "done"
  | "error";

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

  // BP 图片识别相关状态
  const [documentId, setDocumentId] = useState("");
  const [imageCount, setImageCount] = useState(0);
  const [estimatedTokens, setEstimatedTokens] = useState(0);
  const [quotaHint, setQuotaHint] = useState("");
  const [imageNote, setImageNote] = useState("");

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

  interface UploadResponse {
    id: string;
    charCount: number;
    imageCount?: number;
    estimatedTokens?: number;
  }

  async function uploadDocument(pid: string): Promise<UploadResponse> {
    if (!file) throw new Error("未选择文件");

    setProgress(10);
    // 1. 获取上传凭证
    const signRes = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    if (!signRes.ok) {
      const data = await signRes.json();
      throw new Error(data.error || "获取上传地址失败");
    }
    const credential = await signRes.json();

    setProgress(20);
    // 2. 上传文件（OSS直传 或 本地写盘）
    let fileUrl: string;
    if (credential.mode === "oss") {
      const putRes = await fetch(credential.presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("文件上传失败");
      fileUrl = credential.fileUrl;
    } else {
      const objectKey = credential.fileUrl.replace(/^local:\/\//, "");
      const form = new FormData();
      form.append("file", file);
      form.append("objectKey", objectKey);
      const uploadRes = await fetch("/api/upload-local", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("文件上传失败");
      fileUrl = credential.fileUrl;
    }

    setProgress(70);
    // 3. 通知服务器解析
    const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
    const res = await fetch(`/api/projects/${pid}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl: fileUrl, filename: file.name, fileType }),
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

      const uploaded = await uploadDocument(id);
      setCharCount(uploaded.charCount);
      setDocumentId(uploaded.id);

      // BP 检测到内嵌图片：先停在确认态，让用户决定是否识别（按需 Qwen-VL）
      if (uploaded.imageCount && uploaded.imageCount > 0) {
        setImageCount(uploaded.imageCount);
        setEstimatedTokens(uploaded.estimatedTokens || 0);
        setQuotaHint(await checkQuotaHint(uploaded.estimatedTokens || 0));
        setPhase("confirm_images");
      } else {
        setPhase("done");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] 错误：", e);
      setError(msg || "操作失败，请打开浏览器控制台查看详情");
      setPhase("error");
    }
  }

  // 检测到图片时拉取免费额度状态，余额不足则在确认提示中告知
  async function checkQuotaHint(tokens: number): Promise<string> {
    try {
      const res = await fetch("/api/user/quota-status");
      if (!res.ok) return "";
      const q = await res.json();
      if (q.enabled && q.tokensRemaining < tokens) {
        return "当前剩余额度可能不足以完成图片识别，建议配置自己的 API Key";
      }
    } catch {
      // 查询失败不影响主流程
    }
    return "";
  }

  // 用户确认提取图片信息：调用 Qwen-VL 识别，完成后进入 done
  async function analyzeImages() {
    setPhase("analyzing");
    try {
      const res = await fetch(`/api/documents/${documentId}/image-analysis`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "图片识别失败");
      const parts = [`已识别 ${data.count} 张图片`];
      if (data.failed > 0) parts.push(`${data.failed} 张失败`);
      if (data.skipped > 0) parts.push(`另有 ${data.skipped} 张未处理`);
      setImageNote(parts.join("，"));
    } catch (e) {
      setImageNote(e instanceof Error ? e.message : "图片识别失败");
    }
    setPhase("done");
  }

  // BP 检测到图片：确认是否识别（analyzing 时按钮转 loading 态）
  if (phase === "confirm_images" || phase === "analyzing") {
    const analyzing = phase === "analyzing";
    return (
      <div className="mx-auto max-w-doc px-6 py-16">
        <h1 className="text-xl font-semibold text-ink">项目已创建</h1>
        <div className="mt-6 rounded-lg border border-line bg-accent-soft/40 p-5">
          <p className="text-sm text-ink">
            解析完成，共提取 {charCount.toLocaleString()} 字。
          </p>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm text-ink">
              检测到 {imageCount} 张图片，识别可补充产品截图/图表等信息，预计消耗约{" "}
              {formatTokens(estimatedTokens)}。是否提取图片信息？
            </p>
            {quotaHint && (
              <p className="mt-1.5 text-xs text-amber-600">⚠️ {quotaHint}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={analyzeImages}
                disabled={analyzing}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {analyzing ? "图片识别中…" : "提取图片信息"}
              </button>
              <button
                onClick={() => setPhase("done")}
                disabled={analyzing}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-gray-50 disabled:opacity-50"
              >
                跳过
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto max-w-doc px-6 py-16">
        <h1 className="text-xl font-semibold text-ink">项目已创建</h1>
        <div className="mt-6 rounded-lg border border-line bg-accent-soft/40 p-5">
          <p className="text-sm text-ink">
            解析完成，共提取 {charCount.toLocaleString()} 字。
          </p>
          {imageNote && (
            <p className="mt-1 text-xs text-ink-faint">{imageNote}</p>
          )}
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
