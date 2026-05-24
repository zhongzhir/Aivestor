"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { readTextStream, readError } from "@/lib/clientAI";

interface RunnerSkill {
  id: string;
  name: string;
  description: string | null;
  skillType: "catalog" | "custom";
}

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  skill: RunnerSkill;
  onClose: () => void;
}

export function SkillRunner({ skill, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  async function run() {
    setRunning(true);
    setError("");
    setResult("");
    setSaveState("idle");
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill_id: skill.id,
          skill_type: skill.skillType,
          project_id: projectId || undefined,
          extra_input: extraInput || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "运行失败"));
      }
      await readTextStream(res, (t) => setResult((c) => c + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "运行失败");
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/skills/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId || undefined,
          content: result,
          skill_name: skill.name,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "保存失败"));
      }
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaveState("idle");
    }
  }

  const hasResult = result.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-canvas shadow-xl">
        {/* 头部 */}
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{skill.name}</h2>
            {skill.description && (
              <p className="mt-0.5 text-xs text-ink-soft">
                {skill.description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕ 关闭
          </button>
        </div>

        <div className="flex-1 px-6 py-5">
          {/* 关联项目 */}
          <label className="text-xs font-medium text-ink-soft">
            关联项目（可选）
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={running}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-surface"
          >
            <option value="">不关联项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* 补充说明 */}
          <label className="mt-4 block text-xs font-medium text-ink-soft">
            补充说明（可选）
          </label>
          <textarea
            value={extraInput}
            onChange={(e) => setExtraInput(e.target.value)}
            disabled={running}
            rows={2}
            placeholder="特别关注的方面…"
            className="mt-1 w-full resize-none rounded-md border border-line px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent disabled:bg-surface"
          />

          <button
            onClick={run}
            disabled={running}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? "分析中…" : hasResult ? "重新分析" : "开始分析"}
          </button>

          {error && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* 结果 */}
          {(running || hasResult) && (
            <div className="mt-5 border-t border-line pt-5">
              <article className="report-body min-h-[120px]">
                {hasResult ? (
                  <>
                    <ReactMarkdown>{result}</ReactMarkdown>
                    {running && <span className="type-cursor" />}
                  </>
                ) : (
                  <p className="text-sm text-ink-faint">等待 AI 输出…</p>
                )}
              </article>

              {hasResult && !running && (
                <button
                  onClick={save}
                  disabled={saveState !== "idle"}
                  className="mt-4 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                >
                  {saveState === "saving"
                    ? "保存中…"
                    : saveState === "saved"
                      ? projectId
                        ? "✅ 已保存到项目档案"
                        : "✅ 已保存到知识库"
                      : projectId
                        ? "保存到项目档案"
                        : "保存到知识库"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
