"use client";

import { useRef, useState } from "react";
import { SKILL_CATEGORIES, SKILL_STAGES, STAGE_LABELS } from "@/lib/skills";

export interface EditSkillData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  prompt_template: string;
  applicable_stages: string[];
  generatedFromJudgments?: boolean;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  mode?: "create" | "edit";
  initialData?: EditSkillData;
}

export function CreateSkillModal({
  onClose,
  onCreated,
  mode = "create",
  initialData,
}: Props) {
  const isEdit = mode === "edit" && !!initialData;
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [category, setCategory] = useState<string>(
    initialData?.category ?? SKILL_CATEGORIES[0].value
  );
  const [stages, setStages] = useState<string[]>(
    initialData?.applicable_stages ?? []
  );
  const [template, setTemplate] = useState(initialData?.prompt_template ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // AI 帮我写
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDesc, setAiDesc] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const templateRef = useRef<HTMLTextAreaElement>(null);

  async function aiGenerate() {
    const desc = aiDesc.trim();
    if (!desc) {
      setAiError("请描述你想要的分析方向");
      return;
    }
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch("/api/skills/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "生成失败");
      setTemplate(j.prompt || "");
      setAiOpen(false);
      setAiDesc("");
      // 聚焦 prompt 输入框
      window.setTimeout(() => templateRef.current?.focus(), 50);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setAiBusy(false);
    }
  }

  function toggleStage(s: string) {
    setStages((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function save() {
    if (!name.trim()) {
      setError("请填写 SKILL 名称");
      return;
    }
    if (!template.trim()) {
      setError("请填写 Prompt 模板");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        isEdit ? `/api/skills/custom/${initialData!.id}` : "/api/skills/custom",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            category,
            prompt_template: template,
            applicable_stages: stages,
          }),
        }
      );
      if (!res.ok) {
        throw new Error((await res.json()).error || "保存失败");
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-canvas p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? "编辑 SKILL" : "创建我的 SKILL"}
          </h2>
          <button
            onClick={onClose}
            className="text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {isEdit && initialData?.generatedFromJudgments && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
            此 SKILL 由历史判断生成，修改后将不再与判断记录同步。
          </p>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-soft">
              名称 <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-soft">描述</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-soft">分类</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {SKILL_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-soft">
              适用阶段（可多选）
            </label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {SKILL_STAGES.map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-1.5 text-sm text-ink-soft"
                >
                  <input
                    type="checkbox"
                    checked={stages.includes(s)}
                    onChange={() => toggleStage(s)}
                  />
                  {STAGE_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink-soft">
                Prompt 模板 <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setAiOpen((v) => !v);
                  setAiError("");
                }}
                className="text-xs font-medium text-accent hover:underline"
              >
                ✨ AI 帮我写
              </button>
            </div>

            {aiOpen && (
              <div className="mt-2 rounded-md border border-accent/40 bg-accent-soft/40 p-3">
                <p className="text-xs text-ink-soft">
                  描述你想要的分析方向，AI 将帮你生成 prompt
                </p>
                <textarea
                  value={aiDesc}
                  onChange={(e) => setAiDesc(e.target.value)}
                  rows={2}
                  placeholder="例如：帮我分析创始人背景和团队完整性"
                  className="mt-2 w-full resize-none rounded border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                />
                {aiError && (
                  <p className="mt-2 text-xs text-red-600">{aiError}</p>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAiOpen(false);
                      setAiError("");
                    }}
                    disabled={aiBusy}
                    className="rounded border border-line px-3 py-1 text-xs text-ink-soft hover:bg-surface disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={aiGenerate}
                    disabled={aiBusy}
                    className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {aiBusy ? "生成中…" : "生成"}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-2 rounded-md bg-surface px-3 py-2 text-xs text-ink-faint">
              可使用以下变量（运行时自动注入关联项目数据）：
              <br />
              <code>{"{project_info}"}</code> <code>{"{bp_content}"}</code>{" "}
              <code>{"{financial_data}"}</code> <code>{"{judgments}"}</code>
            </p>
            <textarea
              ref={templateRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={8}
              placeholder="请对以下项目进行分析…&#10;&#10;项目信息：&#10;{project_info}&#10;&#10;BP内容：&#10;{bp_content}"
              className="mt-1.5 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "保存中…" : isEdit ? "保存修改" : "保存 SKILL"}
          </button>
        </div>
      </div>
    </div>
  );
}
