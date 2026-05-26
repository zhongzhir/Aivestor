"use client";

import { useEffect, useState } from "react";
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
  skillType: "catalog" | "custom";
  prompt_template?: string;
  metadata?: { generated_from_judgments?: boolean } | null;
}

// 服务端透传的原始行（未带 skillType）
interface RawSkill {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[] | null;
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
    skillType,
  }));
}

export function SkillsClient({
  initialCatalog,
  initialCustom,
  isLoggedIn,
}: {
  initialCatalog: RawSkill[];
  initialCustom: RawSkill[];
  isLoggedIn: boolean;
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
            onRun={() => setRunnerSkill(s)}
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
  onRun,
  onEdit,
  onExport,
  onDelete,
}: {
  skill: SkillItem;
  isLoggedIn: boolean;
  highlight?: boolean;
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
        {isLoggedIn ? (
          <button
            onClick={onRun}
            className="rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
          >
            使用 →
          </button>
        ) : (
          <a
            href={LOGIN_HREF}
            className="rounded-md bg-[#FF6B35] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            登录后使用
          </a>
        )}
      </div>
    </div>
  );
}
