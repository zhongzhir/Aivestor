"use client";

import { useEffect, useState } from "react";

type Task = Record<string, any>;
type Brief = Record<string, any>;

const templates = ["行业动态跟踪", "指定公司跟踪", "基金与机构动态", "政策与监管变化", "AI赛事监测", "自定义情报任务"];
const listValue = (value: unknown) => Array.isArray(value) ? value.join(", ") : "";

export default function IntelligenceSubscriptions() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch("/api/data-apps/intelligence-subscriptions");
    if (!response.ok) throw new Error("加载情报任务失败");
    const data = await response.json();
    setTasks(data.tasks ?? []); setBriefs(data.briefs ?? []);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const csv = (key: string) => String(form.get(key) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const executionMode = String(form.get("executionMode") ?? "manual") as "manual" | "scheduled";
    const payload = {
      name: String(form.get("name") ?? ""), topics: csv("topics"), entities: csv("entities"), keywords: csv("keywords"), regions: csv("regions"),
      includeRequirements: csv("includeRequirements"), excludeRequirements: csv("excludeRequirements"), maxItems: Number(form.get("maxItems") ?? 10),
      lookbackPeriod: String(form.get("lookbackKind") ?? "days") === "custom" ? { kind: "custom", start: String(form.get("lookbackStart") ?? ""), end: String(form.get("lookbackEnd") ?? "") } : { kind: "days", value: Number(form.get("lookback") ?? 3) }, outputInstructions: String(form.get("outputInstructions") ?? ""),
      executionMode, isActive: form.get("isActive") === "on",
      scheduleConfig: executionMode === "scheduled" ? { frequency: String(form.get("frequency") ?? "daily"), time: String(form.get("time") ?? "09:00"), timezone: String(form.get("timezone") ?? "Asia/Shanghai"), weekdays: [Number(form.get("weekday") ?? 1)] } : null,
    };
    const response = await fetch(editing ? `/api/data-apps/intelligence-subscriptions/${editing.id}` : "/api/data-apps/intelligence-subscriptions", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); setError(data.error ?? "保存失败"); setBusy(false); return; }
    setShowForm(false); setEditing(null); await load(); setBusy(false);
  }

  async function action(task: Task, kind: "generate" | "delete" | "toggle") {
    setBusy(true); setError("");
    const url = `/api/data-apps/intelligence-subscriptions/${task.id}`;
    const response = kind === "generate" ? await fetch(`${url}/generate`, { method: "POST" }) : kind === "delete" ? await fetch(url, { method: "DELETE" }) : await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...task, isActive: !task.is_active, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, executionMode: task.execution_mode, scheduleConfig: task.schedule_config }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); setError(data.error ?? "操作失败"); }
    await load(); setBusy(false);
  }

  async function markFeedback(briefId: string, itemKey: string, value: "valuable" | "irrelevant") {
    await fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey, feedback: value }) });
    setFeedback((previous) => ({ ...previous, [`${briefId}:${itemKey}`]: value }));
  }

  function openEdit(task?: Task) { setEditing(task ?? null); setShowForm(true); }
  const current = editing ?? {};
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-ink">🧭 情报订制</h1><p className="mt-1 text-sm text-ink-soft">只围绕你主动创建的情报任务生成简报，不展示默认新闻流。</p></div>
      <button onClick={() => openEdit()} className="rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white">新建情报任务</button>
    </div>
    {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {tasks.length === 0 && !showForm && <div className="mt-8 rounded-lg border border-line bg-white px-6 py-8"><h2 className="text-base font-semibold text-ink">先创建你的第一个情报任务</h2><p className="mt-2 text-sm text-ink-soft">你需要明确关注、排除、时间范围、数量和输出方式；没有启用任务时不会生成个人简报或主动推送。</p><div className="mt-5 flex flex-wrap gap-2">{templates.map((name) => <button key={name} onClick={() => openEdit({ name })} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:border-[#0D1B3E]">{name}</button>)}</div></div>}
    {showForm && <form onSubmit={save} className="mt-6 rounded-lg border border-line bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">{editing ? "编辑情报任务" : "新建情报任务"}</h2><button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="text-sm text-ink-faint">取消</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field label="任务名称" name="name" defaultValue={current.name ?? ""} required /><Field label="主题（逗号分隔）" name="topics" defaultValue={listValue(current.topics)} /><Field label="主体/公司" name="entities" defaultValue={listValue(current.entities)} /><Field label="关键词" name="keywords" defaultValue={listValue(current.keywords)} /><Field label="地域" name="regions" defaultValue={listValue(current.regions)} /><Field label="包含条件" name="includeRequirements" defaultValue={listValue(current.include_requirements)} /><Field label="排除条件" name="excludeRequirements" defaultValue={listValue(current.exclude_requirements)} /><Field label="最多条数" name="maxItems" type="number" defaultValue={current.max_items ?? 10} /><label className="text-sm text-ink-soft">时间范围<select name="lookbackKind" defaultValue={current.lookback_period?.kind === "custom" ? "custom" : String(current.lookback_period?.value ?? 3)} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="1">最近24小时</option><option value="3">最近3天</option><option value="7">最近7天</option><option value="custom">自定义</option></select></label><Field label="自定义开始时间（自定义时填写）" name="lookbackStart" type="datetime-local" defaultValue={current.lookback_period?.start ?? ""} /><Field label="自定义结束时间（自定义时填写）" name="lookbackEnd" type="datetime-local" defaultValue={current.lookback_period?.end ?? ""} />
      <label className="text-sm text-ink-soft sm:col-span-2">输出要求<textarea name="outputInstructions" defaultValue={current.output_instructions ?? ""} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" placeholder="例如：区分重要事实与趋势信号，突出对早期投资的影响" /></label>
      <label className="text-sm text-ink-soft">执行方式<select name="executionMode" defaultValue={current.execution_mode ?? "manual"} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="manual">手动生成</option><option value="scheduled">定时生成</option></select></label>
      <label className="flex items-end gap-2 pb-2 text-sm text-ink-soft"><input type="checkbox" name="isActive" defaultChecked={current.is_active === true} /> 启用任务</label>
      <Field label="定时频率（scheduled 时生效）" name="frequency" defaultValue={current.schedule_config?.frequency ?? "daily"} /><Field label="时间（用户时区）" name="time" defaultValue={current.schedule_config?.time ?? "09:00"} /><Field label="时区" name="timezone" defaultValue={current.schedule_config?.timezone ?? "Asia/Shanghai"} /><Field label="星期（0=周日，1=周一）" name="weekday" type="number" defaultValue={current.schedule_config?.weekdays?.[0] ?? 1} />
    </div><button disabled={busy} className="mt-4 rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">保存任务</button></form>}
    {tasks.length > 0 && <section className="mt-7"><h2 className="text-base font-semibold">我的情报任务</h2><div className="mt-3 grid gap-3">{tasks.map((task) => <div key={task.id} className="rounded-lg border border-line bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{task.name}</h3><p className="mt-1 text-xs text-ink-faint">{task.execution_mode === "scheduled" ? `定时 · ${task.schedule_config?.frequency ?? ""} ${task.schedule_config?.time ?? ""} ${task.schedule_config?.timezone ?? ""}` : "手动生成"} · {task.is_active ? "已启用" : "已停用"}</p></div><div className="flex gap-3 text-xs"><button onClick={() => action(task, "generate")} className="text-accent">生成本期简报</button><button onClick={() => openEdit(task)} className="text-ink-soft">编辑</button><button onClick={() => action(task, "toggle")} className="text-ink-soft">{task.is_active ? "停用" : "启用"}</button><button onClick={() => action(task, "delete")} className="text-red-600">删除</button></div></div></div>)}</div></section>}
    <section className="mt-7"><h2 className="text-base font-semibold">最近生成结果 / 历史简报</h2>{briefs.length === 0 ? <p className="mt-3 text-sm text-ink-faint">还没有生成结果。</p> : <div className="mt-3 space-y-3">{briefs.map((brief) => <div key={brief.id} className="rounded-lg border border-line bg-white px-4 py-3"><div className="flex justify-between gap-3"><div><p className="text-sm font-medium">{brief.task_name}</p><p className="mt-1 text-xs text-ink-faint">覆盖 {new Date(brief.coverage_start).toLocaleDateString("zh-CN")} 至 {new Date(brief.coverage_end).toLocaleDateString("zh-CN")} · 生成 {new Date(brief.generated_at).toLocaleString("zh-CN")}</p></div><span className="text-xs text-ink-soft">{brief.item_count} 条</span></div>{[...(brief.important_facts ?? []).map((x: any) => ({ ...x, section: "重要事实" })), ...(brief.trend_signals ?? []).map((x: any) => ({ ...x, section: "趋势信号" })), ...(brief.other_items ?? []).map((x: any) => ({ ...x, section: "其他相关信息" }))].map((item: any) => <div key={item.id} className="mt-3 border-t border-line pt-3"><p className="text-xs text-accent">{item.section}</p><p className="mt-1 text-sm font-medium">{item.title}</p><p className="mt-1 text-sm text-ink-soft">{item.content}</p><p className="mt-1 text-xs text-ink-faint">来源：{item.source} · {new Date(item.publishedAt).toLocaleString("zh-CN")}</p><div className="mt-2 flex gap-2 text-xs"><button onClick={() => markFeedback(brief.id, item.id, "valuable")} className={feedback[`${brief.id}:${item.id}`] === "valuable" ? "font-semibold text-accent" : "text-ink-faint"}>有价值</button><button onClick={() => markFeedback(brief.id, item.id, "irrelevant")} className={feedback[`${brief.id}:${item.id}`] === "irrelevant" ? "font-semibold text-red-600" : "text-ink-faint"}>无关</button></div></div>)}</div>)}</div>}</section>
  </div>;
}

function Field({ label, name, defaultValue, type = "text", required = false }: { label: string; name: string; defaultValue?: string | number; type?: string; required?: boolean }) { return <label className="text-sm text-ink-soft">{label}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" /></label>; }
