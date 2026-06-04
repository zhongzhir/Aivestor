"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import type { InvestmentStyle, UserProfile } from "@/lib/user-profile";

const STAGE_OPTIONS = ["天使", "Pre-A", "A轮", "B轮", "成长期", "不限"];
const SECTOR_PRESETS = [
  "消费",
  "企服/SaaS",
  "硬科技",
  "医疗健康",
  "文娱",
  "新能源",
  "农业",
  "出海",
];
const STYLE_OPTIONS: { value: InvestmentStyle; label: string }[] = [
  { value: "financial", label: "财务回报导向" },
  { value: "strategic", label: "战略布局导向" },
  { value: "founder_first", label: "Founder 优先" },
  { value: "thesis_driven", label: "主题投资" },
];

type FormState = Omit<UserProfile, "user_id">;

const EMPTY: FormState = {
  focus_stages: [],
  focus_sectors: [],
  investment_style: null,
  check_size: null,
  typical_hold_period: null,
  self_intro: null,
  decision_criteria: null,
  avoid_patterns: null,
  output_preference: null,
  extra_context: null,
  screening_criteria: {
    hard_pass: [],
    preferred_stages: [],
    preferred_sectors: [],
  },
};

type TemplateKey = "early" | "growth" | "angel";

const TEMPLATES: Record<TemplateKey, Partial<FormState>> = {
  early: {
    focus_stages: ["天使", "Pre-A", "A轮"],
    focus_sectors: ["消费", "企服/SaaS", "硬科技"],
    investment_style: "founder_first",
    decision_criteria:
      "我最看重创始人的学习能力、执行力和对行业的独特认知。其次看市场空间是否足够大，商业模式是否有自然的规模效应。",
    avoid_patterns:
      "纯To G项目、没有核心壁垒的信息撮合模式、创始团队股权过于分散或存在明显内部矛盾的项目。",
    output_preference:
      "直接给出判断结论，用数据支撑，指出最需要核实的2-3个关键假设。",
  },
  growth: {
    focus_stages: ["B轮", "成长期"],
    investment_style: "financial",
    decision_criteria:
      "核心看收入规模和增长质量，重视单位经济模型是否跑通，关注净收入留存率和扩张系数。",
    avoid_patterns:
      "收入质量差（补贴驱动）、创始人不懂财务的项目、行业格局已定且自身无差异化的项目。",
    output_preference:
      "财务数据优先，给出同类公司对比，明确指出估值合理区间和关键风险。",
  },
  angel: {
    focus_stages: ["天使"],
    investment_style: "founder_first",
    decision_criteria:
      "几乎只看人，要求创始人有深度的行业认知和强烈的使命感，愿意在不确定性极高的早期阶段押注创始人本身。",
    avoid_patterns: "纯财务驱动、没有真正用户痛点的项目。",
    output_preference:
      "重点分析创始人背景和创业动机，其次分析赛道逻辑，财务数据权重较低。",
  },
};

export function ProfileForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sectorInput, setSectorInput] = useState("");
  const [hardPassInput, setHardPassInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/user/profile");
        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            setForm({
              focus_stages: data.profile.focus_stages ?? [],
              focus_sectors: data.profile.focus_sectors ?? [],
              investment_style: data.profile.investment_style ?? null,
              check_size: data.profile.check_size ?? null,
              typical_hold_period: data.profile.typical_hold_period ?? null,
              self_intro: data.profile.self_intro ?? null,
              decision_criteria: data.profile.decision_criteria ?? null,
              avoid_patterns: data.profile.avoid_patterns ?? null,
              output_preference: data.profile.output_preference ?? null,
              extra_context: data.profile.extra_context ?? null,
              screening_criteria: data.profile.screening_criteria ?? {
                hard_pass: [],
                preferred_stages: [],
                preferred_sectors: [],
              },
            });
            setEmpty(false);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleStage(stage: string) {
    setForm((f) => ({
      ...f,
      focus_stages: f.focus_stages.includes(stage)
        ? f.focus_stages.filter((s) => s !== stage)
        : [...f.focus_stages, stage],
    }));
  }

  function addSector(value: string) {
    const v = value.trim();
    if (!v) return;
    setForm((f) =>
      f.focus_sectors.includes(v)
        ? f
        : { ...f, focus_sectors: [...f.focus_sectors, v] }
    );
    setSectorInput("");
  }

  function removeSector(s: string) {
    setForm((f) => ({
      ...f,
      focus_sectors: f.focus_sectors.filter((x) => x !== s),
    }));
  }

  function onSectorKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addSector(sectorInput);
    }
  }

  function addHardPass(value: string) {
    const v = value.trim();
    if (!v) return;
    setForm((f) => {
      const sc = f.screening_criteria ?? {
        hard_pass: [],
        preferred_stages: [],
        preferred_sectors: [],
      };
      if (sc.hard_pass.includes(v)) return f;
      return {
        ...f,
        screening_criteria: { ...sc, hard_pass: [...sc.hard_pass, v] },
      };
    });
    setHardPassInput("");
  }

  function removeHardPass(index: number) {
    setForm((f) => {
      const sc = f.screening_criteria;
      if (!sc) return f;
      const next = [...sc.hard_pass];
      next.splice(index, 1);
      return { ...f, screening_criteria: { ...sc, hard_pass: next } };
    });
  }

  function onHardPassKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addHardPass(hardPassInput);
    }
  }

  function applyTemplate(key: TemplateKey) {
    setForm((f) => ({ ...f, ...TEMPLATES[key] }));
    setMessage("已套用模板，请检查并保存");
  }

  async function onSave() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setMessage("已保存，AI 将在下次对话中应用你的偏好");
        setEmpty(false);
      } else {
        setMessage("保存失败，请稍后再试");
      }
    } catch {
      setMessage("网络异常，保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-ink-faint">加载中…</p>;
  }

  return (
    <div className="space-y-8">
      {empty && (
        <div className="rounded border border-line bg-canvas-soft px-3 py-2 text-xs text-ink-soft">
          完善投资人画像，让 AI 分析更贴合你的判断风格 →
        </div>
      )}

      {/* 区块一：基本信息 */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-ink">基本信息</h3>

        <div>
          <label className="block text-xs text-ink-faint">关注阶段</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {STAGE_OPTIONS.map((s) => {
              const active = form.focus_stages.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStage(s)}
                  className={`rounded border px-3 py-1 text-xs ${
                    active
                      ? "border-[#1B6FE8] bg-[#1B6FE8] text-white"
                      : "border-line text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-faint">关注赛道</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {form.focus_sectors.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded bg-[#1B6FE8] px-2 py-0.5 text-xs text-white"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSector(s)}
                  className="text-white/80 hover:text-white"
                  aria-label={`移除 ${s}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={sectorInput}
            onChange={(e) => setSectorInput(e.target.value)}
            onKeyDown={onSectorKey}
            placeholder="输入赛道后按 Enter 添加"
            className="mt-2 w-full rounded border border-line bg-white px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SECTOR_PRESETS.filter(
              (s) => !form.focus_sectors.includes(s)
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSector(s)}
                className="rounded border border-dashed border-line px-2 py-0.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink-soft"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-faint">投资风格</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLE_OPTIONS.map((opt) => {
              const active = form.investment_style === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      investment_style: active ? null : opt.value,
                    }))
                  }
                  className={`rounded border px-3 py-1 text-xs ${
                    active
                      ? "border-[#1B6FE8] bg-[#1B6FE8] text-white"
                      : "border-line text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-ink-faint">典型投资规模</label>
            <input
              type="text"
              value={form.check_size ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, check_size: e.target.value || null }))
              }
              placeholder="例如：500万-2000万人民币"
              className="mt-1 w-full rounded border border-line bg-white px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-faint">典型持有周期</label>
            <input
              type="text"
              value={form.typical_hold_period ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  typical_hold_period: e.target.value || null,
                }))
              }
              placeholder="例如：3-5年"
              className="mt-1 w-full rounded border border-line bg-white px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* 区块二：判断标准 */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-ink">判断标准</h3>

        <div>
          <label className="block text-xs text-ink-faint">我最看重</label>
          <textarea
            rows={4}
            value={form.decision_criteria ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                decision_criteria: e.target.value || null,
              }))
            }
            placeholder="例如：创始人的学习能力和执行力、市场空间是否足够大、商业模式是否有自然的网络效应…"
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-faint">我明确回避</label>
          <textarea
            rows={4}
            value={form.avoid_patterns ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                avoid_patterns: e.target.value || null,
              }))
            }
            placeholder="例如：纯To G依赖政府补贴的项目、没有壁垒的信息撮合模式、创始团队股权过于分散…"
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </div>

        {/* 结构化硬性否决项：命中任一直接 PASS */}
        <div>
          <label className="block text-xs text-ink-faint">
            硬性否决项（结构化）
          </label>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            符合以下任一条件的项目，简要分析时会被直接标记 PASS。建议 3–5 条，过多会影响分析质量。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(form.screening_criteria?.hard_pass ?? []).map((item, idx) => (
              <span
                key={`${idx}-${item}`}
                className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700"
              >
                {item}
                <button
                  type="button"
                  onClick={() => removeHardPass(idx)}
                  className="text-red-400 hover:text-red-600"
                  aria-label={`移除 ${item}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={hardPassInput}
            onChange={(e) => setHardPassInput(e.target.value)}
            onKeyDown={onHardPassKey}
            placeholder="例如：纯国内市场、天使轮前、无技术壁垒…（输入后按 Enter）"
            className="mt-2 w-full rounded border border-line bg-white px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </div>
      </section>

      {/* 区块三：AI 协作偏好 */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-ink">AI 协作偏好</h3>

        <div>
          <label className="block text-xs text-ink-faint">输出风格偏好</label>
          <textarea
            rows={3}
            value={form.output_preference ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                output_preference: e.target.value || null,
              }))
            }
            placeholder="例如：直接给结论不要客套、多用数据和类比、在给出观点前先陈述假设…"
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-faint">其他补充</label>
          <textarea
            rows={3}
            value={form.extra_context ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                extra_context: e.target.value || null,
              }))
            }
            placeholder="你希望 AI 在分析中额外注意的事项"
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </div>
      </section>

      {/* 模板 */}
      <section>
        <p className="text-xs text-ink-faint">一键填充模板</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyTemplate("early")}
            className="rounded border border-line px-3 py-1 text-xs text-ink-soft hover:border-ink-faint"
          >
            早期基金模板
          </button>
          <button
            type="button"
            onClick={() => applyTemplate("growth")}
            className="rounded border border-line px-3 py-1 text-xs text-ink-soft hover:border-ink-faint"
          >
            成长期基金模板
          </button>
          <button
            type="button"
            onClick={() => applyTemplate("angel")}
            className="rounded border border-line px-3 py-1 text-xs text-ink-soft hover:border-ink-faint"
          >
            个人天使模板
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-[#0D1B3E] px-4 py-1.5 text-xs text-white hover:bg-[#1B6FE8] disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存画像"}
        </button>
        {message && (
          <span className="text-xs text-ink-faint">{message}</span>
        )}
      </div>
    </div>
  );
}
