"use client";

import { useEffect, useRef, useState } from "react";
import { SkillRunner } from "@/components/skills/SkillRunner";
import { CreateSkillModal } from "@/components/skills/CreateSkillModal";
import { ImportSkillModal } from "@/components/skills/ImportSkillModal";
import { CATEGORY_ICONS, STAGE_LABELS } from "@/lib/skills";

interface SkillItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[];
  requires_capability: string | null;
  skillType: "catalog" | "custom";
  prompt_template?: string;
  metadata?: { generated_from_judgments?: boolean } | null;
}

interface ClProject {
  id: string;
  name: string;
  industry: string | null;
}

// 服务端透传的原始行（未带 skillType）
interface RawSkill {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[] | null;
  requires_capability: string | null;
  prompt_template?: string;
  metadata?: { generated_from_judgments?: boolean } | null;
}

type TabKey =
  | "all"
  | "analysis"
  | "due_diligence"
  | "valuation"
  | "post_investment"
  | "mine";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "analysis", label: "分析框架" },
  { key: "due_diligence", label: "尽调工具" },
  { key: "valuation", label: "估值决策" },
  { key: "post_investment", label: "投后管理" },
  { key: "mine", label: "我的 SKILL" },
];

const LOGIN_HREF = "/login?callbackUrl=/skills";

function withType(rows: RawSkill[], skillType: "catalog" | "custom"): SkillItem[] {
  return rows.map((s) => ({
    ...s,
    applicable_stages: s.applicable_stages ?? [],
    requires_capability: s.requires_capability ?? null,
    skillType,
  }));
}

export function SkillsClient({
  initialCatalog,
  initialCustom,
  isLoggedIn,
  hasZjjrData = false,
}: {
  initialCatalog: RawSkill[];
  initialCustom: RawSkill[];
  isLoggedIn: boolean;
  hasZjjrData?: boolean;
}) {
  const [catalog, setCatalog] = useState<SkillItem[]>(() =>
    withType(initialCatalog, "catalog")
  );
  const [custom, setCustom] = useState<SkillItem[]>(() =>
    withType(initialCustom, "custom")
  );
  const [tab, setTab] = useState<TabKey>("all");
  const [runnerSkill, setRunnerSkill] = useState<SkillItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editSkill, setEditSkill] = useState<SkillItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [judgmentCount, setJudgmentCount] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // 竞争格局分析专用 Modal（zjjr_data skills 绕过 SkillRunner，直调专用路由）
  const [clSkill, setClSkill] = useState<SkillItem | null>(null);
  const [clProjects, setClProjects] = useState<ClProject[]>([]);
  const [clProjectId, setClProjectId] = useState("");
  const [clIndustry, setClIndustry] = useState("");
  const [clRunning, setClRunning] = useState(false);
  const [clError, setClError] = useState("");
  const [clResult, setClResult] = useState("");
  const clResultRef = useRef<HTMLDivElement>(null);

  const visibleTabs = isLoggedIn ? TABS : TABS.filter((t) => t.key !== "mine");

  // 刷新自建/官方 SKILL（仅登录用户在创建/导入后调用）
  async function load() {
    try {
      const res = await fetch("/api/skills/catalog");
      const data = await res.json();
      setCatalog(withType(data.catalog ?? [], "catalog"));
      setCustom(withType(data.custom ?? [], "custom"));
    } catch {
      /* 静默：保留现有数据 */
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    // 判断记录数（用于「从我的历史判断生成专属 SKILL」入口）
    fetch("/api/skills/judgments-count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setJudgmentCount(d.count ?? 0))
      .catch(() => setJudgmentCount(0));
  }, [isLoggedIn]);

  useEffect(() => {
    if (!clSkill) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setClProjects(d.projects ?? []))
      .catch(() => {});
  }, [clSkill]);

  function closeClModal() {
    setClSkill(null);
    setClProjects([]);
    setClProjectId("");
    setClIndustry("");
    setClRunning(false);
    setClError("");
    setClResult("");
  }

  async function runCompetitiveLandscape() {
    if (!clIndustry.trim()) {
      setClError("请填写行业关键词");
      return;
    }
    setClRunning(true);
    setClError("");
    setClResult("");
    try {
      const res = await fetch("/api/skills/competitive-landscape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: clProjectId || undefined,
          industry: clIndustry.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "分析失败");
      }
      const reportId = res.headers.get("X-Report-Id");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setClResult(text);
          clResultRef.current?.scrollTo({
            top: clResultRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      }
      if (reportId && clProjectId) {
        window.location.href = `/projects/${clProjectId}/report?reportId=${reportId}`;
      }
      // 无 project_id 时：结果已显示在 clResult，用户可自行关闭
    } catch (e) {
      setClError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setClRunning(false);
    }
  }

  function flashHighlight(id: string) {
    setHighlightId(id);
    window.setTimeout(
      () => setHighlightId((cur) => (cur === id ? null : cur)),
      3000
    );
  }

  async function generateFromJudgments() {
    setGenerating(true);
    setGenerateError("");
    try {
      const res = await fetch("/api/skills/generate-from-judgments", {
        method: "POST",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "生成失败");
      await load();
      setTab("mine");
      if (j.skill?.id) flashHighlight(j.skill.id);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function exportSkill(skill: SkillItem) {
    if (!skill.prompt_template) {
      alert("无法导出：缺少 prompt 模板");
      return;
    }
    const payload = {
      aivestor_skill_version: "1.0",
      exported_at: new Date().toISOString(),
      skill: {
        name: skill.name,
        description: skill.description ?? "",
        prompt: skill.prompt_template,
        category: skill.category,
        applicable_stages: skill.applicable_stages,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const safeName = skill.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aivestor-skill-${safeName}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function deleteCustom(id: string) {
    if (!confirm("确定删除该自建 SKILL？")) return;
    const res = await fetch(`/api/skills/custom/${id}`, { method: "DELETE" });
    if (res.ok) setCustom((prev) => prev.filter((s) => s.id !== id));
  }

  const visible: SkillItem[] =
    tab === "mine"
      ? custom
      : tab === "all"
        ? catalog
        : catalog.filter((s) => s.category === tab);

  return (
    <>
      {/* 工具栏：仅登录用户可创建 / 导入 */}
      {isLoggedIn && (
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="rounded-md border border-line px-3 py-2 text-sm text-ink-soft hover:bg-surface"
          >
            导入 SKILL
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            创建我的 SKILL
          </button>
        </div>
      )}

      {/* 分类 Tab */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-line">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-accent font-medium text-accent"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 「从我的历史判断生成专属 SKILL」入口（仅登录 + mine tab） */}
      {isLoggedIn && tab === "mine" && (
        <JudgmentSkillCard
          count={judgmentCount}
          generating={generating}
          error={generateError}
          onGenerate={generateFromJudgments}
        />
      )}

      {/* SKILL 卡片网格 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <SkillCard
            key={s.id}
            skill={s}
            isLoggedIn={isLoggedIn}
            highlight={s.id === highlightId}
            capabilityGranted={
              s.requires_capability === "zjjr_data" ? hasZjjrData : true
            }
            onRun={() => {
              if (s.requires_capability === "zjjr_data") {
                setClSkill(s);
              } else {
                setRunnerSkill(s);
              }
            }}
            onEdit={
              s.skillType === "custom" ? () => setEditSkill(s) : undefined
            }
            onExport={
              s.skillType === "custom" ? () => exportSkill(s) : undefined
            }
            onDelete={
              s.skillType === "custom" ? () => deleteCustom(s.id) : undefined
            }
          />
        ))}

        {/* 我的 SKILL：创建入口 */}
        {isLoggedIn && tab === "mine" && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex min-h-[150px] items-center justify-center rounded-lg border border-dashed border-line text-sm text-ink-faint hover:border-accent hover:text-accent"
          >
            + 创建新 SKILL
          </button>
        )}
      </div>

      {visible.length === 0 && tab !== "mine" && (
        <p className="mt-8 text-sm text-ink-faint">该分类暂无 SKILL。</p>
      )}
      {isLoggedIn && visible.length === 0 && tab === "mine" && (
        <p className="mt-4 text-xs text-ink-faint">
          还没有自建 SKILL，点击上方卡片创建第一个。
        </p>
      )}

      {/* 未登录引导条 */}
      {!isLoggedIn && (
        <div className="mt-8 rounded-xl border border-[#FFD9C7] bg-[#FFF4EE] p-4 text-sm text-[#9A4521]">
          登录后即可调用这些分析框架，并创建、导入、生成你的专属 SKILL。{" "}
          <a href={LOGIN_HREF} className="font-medium text-[#FF6B35] hover:underline">
            登录 / 注册 →
          </a>
        </div>
      )}

      {/* 运行面板（仅登录） */}
      {isLoggedIn && runnerSkill && (
        <SkillRunner skill={runnerSkill} onClose={() => setRunnerSkill(null)} />
      )}

      {/* 创建面板 */}
      {isLoggedIn && showCreate && (
        <CreateSkillModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setTab("mine");
            load();
          }}
        />
      )}

      {/* 编辑面板 */}
      {isLoggedIn && editSkill && (
        <CreateSkillModal
          mode="edit"
          initialData={{
            id: editSkill.id,
            name: editSkill.name,
            description: editSkill.description,
            category: editSkill.category,
            prompt_template: editSkill.prompt_template ?? "",
            applicable_stages: editSkill.applicable_stages ?? [],
            generatedFromJudgments:
              editSkill.metadata?.generated_from_judgments === true,
          }}
          onClose={() => setEditSkill(null)}
          onCreated={() => {
            setEditSkill(null);
            setTab("mine");
            load();
          }}
        />
      )}

      {/* 导入面板 */}
      {isLoggedIn && showImport && (
        <ImportSkillModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            setTab("mine");
            load();
          }}
        />
      )}

      {/* 竞争格局分析 Modal（zjjr_data 专属，绕过 SkillRunner） */}
      {isLoggedIn && clSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                {clSkill.name}
              </h2>
              <button
                onClick={closeClModal}
                className="text-ink-faint hover:text-ink"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            {clSkill.description && (
              <p className="mt-1 text-xs text-ink-soft">{clSkill.description}</p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">
                  关联项目（可选）
                </label>
                <select
                  value={clProjectId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setClProjectId(v);
                    const proj = clProjects.find((p) => p.id === v);
                    if (proj?.industry) setClIndustry(proj.industry);
                  }}
                  className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">不关联项目</option>
                  {clProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">
                  行业关键词 <span className="text-red-500">*</span>
                </label>
                <input
                  value={clIndustry}
                  onChange={(e) => setClIndustry(e.target.value)}
                  placeholder="如：人工智能、新能源、消费品"
                  className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>

              {clError && (
                <p className="text-xs text-red-600">{clError}</p>
              )}

              {clResult && (
                <div
                  ref={clResultRef}
                  className="max-h-60 overflow-y-auto rounded-md border border-line bg-surface p-3 text-xs leading-5 text-ink-soft whitespace-pre-wrap"
                >
                  {clResult}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeClModal}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface"
              >
                {clResult && !clRunning ? "关闭" : "取消"}
              </button>
              {!clResult && (
                <button
                  onClick={runCompetitiveLandscape}
                  disabled={clRunning || !clIndustry.trim()}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {clRunning ? "分析中…" : "开始分析"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function JudgmentSkillCard({
  count,
  generating,
  error,
  onGenerate,
}: {
  count: number | null;
  generating: boolean;
  error: string;
  onGenerate: () => void;
}) {
  const ready = count !== null && count >= 5;
  return (
    <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">
            ✨ 从我的历史判断生成专属 SKILL
          </p>
          <p className="mt-1 text-xs text-slate-600">
            基于你的投资决策记录，提炼个人投资框架
          </p>
          {!ready && count !== null && (
            <p className="mt-1 text-xs text-slate-400">
              当前判断记录数 {count} / 5，至少需要 5 条
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!ready || generating}
          className="shrink-0 rounded-lg bg-[#1B6FE8] px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[#1762d0] disabled:bg-slate-200 disabled:text-slate-500"
        >
          {generating ? "生成中…" : "立即生成"}
        </button>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  isLoggedIn,
  highlight,
  capabilityGranted = true,
  onRun,
  onEdit,
  onExport,
  onDelete,
}: {
  skill: SkillItem;
  isLoggedIn: boolean;
  highlight?: boolean;
  capabilityGranted?: boolean;
  onRun: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}) {
  const icon = skill.category ? CATEGORY_ICONS[skill.category] ?? "🧩" : "🧩";
  return (
    <div
      className={`flex flex-col rounded-lg border bg-surface p-4 transition-all duration-500 ${
        highlight
          ? "border-[#1B6FE8] bg-blue-50 shadow-md ring-2 ring-blue-500/30"
          : "border-line"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-ink">{skill.name}</h3>
        </div>
        {isLoggedIn && onEdit && (
          <button
            onClick={onEdit}
            className="shrink-0 text-xs text-ink-faint hover:text-accent"
            aria-label="编辑"
            title="编辑"
          >
            ✎
          </button>
        )}
        {isLoggedIn && onExport && (
          <button
            onClick={onExport}
            className="shrink-0 text-xs text-ink-faint hover:text-accent"
            aria-label="导出"
            title="导出为 JSON"
          >
            ↓
          </button>
        )}
        {isLoggedIn && onDelete && (
          <button
            onClick={onDelete}
            className="shrink-0 text-xs text-ink-faint hover:text-red-600"
            aria-label="删除"
          >
            ✕
          </button>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-soft">
        {skill.description || "（无描述）"}
      </p>
      {skill.applicable_stages?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skill.applicable_stages.map((st) => (
            <span
              key={st}
              className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent"
            >
              🏷 {STAGE_LABELS[st] ?? st}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        {!isLoggedIn ? (
          <a
            href={LOGIN_HREF}
            className="rounded-md bg-[#FF6B35] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            登录后使用
          </a>
        ) : !capabilityGranted ? (
          <button
            disabled
            title="需要机构版且开通中鉴数据增强"
            className="cursor-not-allowed rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-faint"
          >
            机构版专属
          </button>
        ) : (
          <button
            onClick={onRun}
            className="rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
          >
            使用 →
          </button>
        )}
      </div>
    </div>
  );
}
