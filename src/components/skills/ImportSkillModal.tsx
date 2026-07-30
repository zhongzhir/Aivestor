"use client";

import { useRef, useState } from "react";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

interface PreviewShape {
  name: string;
  description?: string | null;
  category?: string | null;
  prompt: string;
  format: "aivestor" | "generic";
}

function parseFile(text: string): PreviewShape | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "文件不是合法 JSON" };
  }
  if (!json || typeof json !== "object") {
    return { error: "JSON 不是对象" };
  }
  const obj = json as Record<string, unknown>;

  if (obj.aivestor_skill_version && obj.skill && typeof obj.skill === "object") {
    const s = obj.skill as Record<string, unknown>;
    if (typeof s.name !== "string" || !s.name.trim()) {
      return { error: "缺少 skill.name" };
    }
    if (typeof s.prompt !== "string" || !s.prompt.trim()) {
      return { error: "缺少 skill.prompt" };
    }
    return {
      name: s.name,
      description: typeof s.description === "string" ? s.description : null,
      category: typeof s.category === "string" ? s.category : null,
      prompt: s.prompt,
      format: "aivestor",
    };
  }

  // 通用格式
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    return { error: "JSON 缺少 name 字段" };
  }
  if (typeof obj.prompt !== "string" || !obj.prompt.trim()) {
    return { error: "JSON 缺少 prompt 字段" };
  }
  return {
    name: obj.name,
    description: typeof obj.description === "string" ? obj.description : null,
    category: typeof obj.category === "string" ? obj.category : null,
    prompt: obj.prompt,
    format: "generic",
  };
}

export function ImportSkillModal({ onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewShape | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [rawJson, setRawJson] = useState<string>("");

  async function onPick(file: File) {
    setError("");
    setPreview(null);
    if (file.size > 256 * 1024) {
      setError("文件超过 256KB，请检查");
      return;
    }
    const text = await file.text();
    setRawJson(text);
    const parsed = parseFile(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setPreview(parsed);
  }

  async function doImport() {
    if (!preview) return;
    setImporting(true);
    setError("");
    try {
      // 直接把原始 JSON 作为 body 发送，后端按相同规则解包
      const res = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawJson,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "导入失败");
      }
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-canvas p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">导入 SKILL</h2>
          <button
            onClick={onClose}
            className="text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
          支持本系统导出的 JSON 格式；
          兼容包含 <code className="px-1">name</code> + <code className="px-1">prompt</code>{" "}
          字段的通用格式（如豆包、GPTs 等）
        </p>

        <div className="mt-4">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft hover:border-accent hover:text-accent"
          >
            {preview ? "重新选择文件" : "选择 .json 文件"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        {preview && (
          <div className="mt-4 rounded-lg border border-line p-4">
            <p className="text-xs text-ink-faint">
              格式：{preview.format === "aivestor" ? "系统导出" : "通用"}
            </p>
            <p className="mt-2 text-sm font-medium text-ink">
              {preview.name}
            </p>
            {preview.description && (
              <p className="mt-1 text-xs text-ink-soft">{preview.description}</p>
            )}
            {preview.category && (
              <p className="mt-1 text-xs text-ink-faint">
                分类：{preview.category}
              </p>
            )}
            <button
              type="button"
              onClick={() => setPromptOpen((v) => !v)}
              className="mt-3 text-xs text-accent hover:underline"
            >
              {promptOpen ? "收起 Prompt" : "查看 Prompt"}
            </button>
            {promptOpen && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 px-3 py-2 text-xs text-ink-soft">
                {preview.prompt}
              </pre>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={importing}
            className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={doImport}
            disabled={!preview || importing}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {importing ? "导入中…" : "确认导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
