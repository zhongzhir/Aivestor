"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { readTextStream, readError } from "@/lib/clientAI";
import { CATEGORY_ICONS, CATEGORY_LABELS } from "@/lib/skills";

interface SkillItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[];
  skillType: "catalog" | "custom";
}

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  // 分析结果存入项目档案后回调（用于刷新档案/报告列表）
  onSaved?: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function SkillRunModal({
  projectId,
  projectName,
  onClose,
  onSaved,
}: Props) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<SkillItem | null>(null);
  const [supplement, setSupplement] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [runAt, setRunAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/skills/catalog");
        const data = await res.json();
        if (cancelled) return;
        const catalog: SkillItem[] = (data.catalog ?? []).map(
          (s: SkillItem) => ({ ...s, skillType: "catalog" as const })
        );
        const custom: SkillItem[] = (data.custom ?? []).map((s: SkillItem) => ({
          ...s,
          skillType: "custom" as const,
        }));
        setSkills([...custom, ...catalog]);
      } catch {
        if (!cancelled) setSkills([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q)
    );
  }, [skills, search]);

  async function run() {
    if (!selected) return;
    setRunning(true);
    setError("");
    setResult("");
    setSaveState("idle");
    setRunAt(new Date().toISOString());
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill_id: selected.id,
          skill_type: selected.skillType,
          project_id: projectId,
          extra_input: supplement || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "运行失败"));
      }
      let acc = "";
      await readTextStream(res, (t) => {
        acc += t;
        setResult((c) => c + t);
      });
      await save(acc.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "运行失败");
    } finally {
      setRunning(false);
    }
  }

  // 分析完成后自动写入项目档案的「分析报告」（带【SKILL】前缀 → 紫色角标）
  async function save(content: string) {
    if (!content || !selected) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/skills/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          content,
          skill_name: selected.name,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "保存失败"));
      }
      setSaveState("saved");
      onSaved?.();
    } catch {
      setSaveState("error");
    }
  }

  const hasResult = result.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-canvas shadow-xl">
        {/* 头部 */}
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              {selected ? selected.name : "SKILL 分析"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              {selected
                ? `关联项目：${projectName}`
                : "选择一个 SKILL，对当前项目进行结构化分析"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕ 关闭
          </button>
        </div>

        {/* 第一步：选择 SKILL */}
        {!selected && (
          <div className="flex flex-1 flex-col px-6 py-5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 SKILL 名称或描述…"
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
            {loading ? (
              <p className="mt-6 text-sm text-ink-faint">加载中…</p>
            ) : filtered.length === 0 ? (
              <p className="mt-6 text-sm text-ink-faint">没有匹配的 SKILL。</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {filtered.map((s) => (
                  <li key={`${s.skillType}-${s.id}`}>
                    <button
                      onClick={() => setSelected(s)}
                      className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-3 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
                    >
                      <span className="text-lg">
                        {s.category ? CATEGORY_ICONS[s.category] ?? "🧩" : "🧩"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {s.name}
                          </span>
                          {s.skillType === "custom" && (
                            <span className="shrink-0 rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-inset ring-purple-200">
                              自建
                            </span>
                          )}
                          {s.skillType === "catalog" && s.category && (
                            <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
                              {CATEGORY_LABELS[s.category] ?? s.category}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-ink-soft">
                          {s.description || "（无描述）"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 第二步：补充说明 + 运行 + 结果 */}
        {selected && (
          <div className="flex-1 px-6 py-5">
            {!running && !hasResult && (
              <button
                onClick={() => setSelected(null)}
                className="mb-4 text-xs font-medium text-accent hover:underline"
              >
                ← 重新选择 SKILL
              </button>
            )}

            <label className="block text-xs font-medium text-ink-soft">
              补充说明（可选）
            </label>
            <textarea
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
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
                {/* 结果头部：SKILL 名称 · 项目 · 时间 */}
                <div className="mb-3">
                  <p className="text-sm font-semibold text-ink">
                    {selected.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {projectName}
                    {runAt && (
                      <>
                        {" · "}
                        {new Date(runAt).toLocaleString("zh-CN")}
                      </>
                    )}
                  </p>
                </div>

                <article className="report-body min-h-[120px]">
                  {hasResult ? (
                    <>
                      <ReactMarkdown
                        rehypePlugins={[rehypeRaw, rehypeSanitize]}
                      >
                        {result}
                      </ReactMarkdown>
                      {running && <span className="type-cursor" />}
                    </>
                  ) : (
                    <p className="text-sm text-ink-faint">等待 AI 输出…</p>
                  )}
                </article>

                {!running && hasResult && (
                  <div className="mt-4 text-sm">
                    {saveState === "saving" && (
                      <span className="text-ink-faint">正在存入项目档案…</span>
                    )}
                    {saveState === "saved" && (
                      <span className="text-green-700">
                        ✅ 已存入项目档案「分析报告」
                      </span>
                    )}
                    {saveState === "error" && (
                      <button
                        onClick={() => save(result.trim())}
                        className="rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
                      >
                        保存失败，点击重试
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
