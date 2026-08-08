"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Task = Record<string, any>;
type Brief = Record<string, any>;
type Plan = { task: Task; questions: string[] };

const templates = [
  { label: "行业动态跟踪", text: "每周一上午9点，整理最近一周我关注行业的关键变化，区分重要事实和趋势，不超过10条。" },
  { label: "指定公司跟踪", text: "每天上午9点，整理最近3天指定公司的重要动态，优先保留融资、产品和经营变化，不超过10条。" },
  { label: "基金与机构动态", text: "每周一上午9点，整理最近一周重点基金与投资机构的投资和募资动态，不超过10条。" },
  { label: "政策与监管变化", text: "每周一上午9点，整理最近一周国内AI相关政策与监管变化，突出对项目判断的影响，不超过10条。" },
  { label: "AI赛事监测", text: "每周一上午9点，整理最近一周国内AI赛事，重点北京、有奖金、适合我的项目参赛，同一赛事合并，不超过20条。" },
  { label: "自定义关注", text: "我想持续关注一个行业或主题，请按重要性整理相关事实和趋势，每周生成一次，不超过10条。" },
];

const listValue = (value: unknown) => Array.isArray(value) ? value.join(", ") : "";
const read = (task: Task, camel: string, snake: string, fallback: any = "") => task[camel] ?? task[snake] ?? fallback;
const scheduleOf = (task: Task) => read(task, "scheduleConfig", "schedule_config", null) ?? {};

function friendlyError(message: string): string {
  if (message.includes("时间") || message.includes("时区")) return "时间安排需要再确认一下，请修改描述后重试。";
  if (message.includes("任务名称")) return "请给这项关注起一个简短名称，然后再试一次。";
  return "暂时没有完成，请检查描述后重试。";
}

function localDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function IntelligenceSubscriptions() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [advancedSeed, setAdvancedSeed] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [aiSource, setAiSource] = useState<"custom" | "platform" | null>(null);
  const [quotaAvailable, setQuotaAvailable] = useState(true);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", []);

  async function load() {
    const response = await fetch("/api/data-apps/intelligence-subscriptions");
    if (!response.ok) throw new Error("load");
    const data = await response.json();
    setTasks(data.tasks ?? []);
    setBriefs(data.briefs ?? []);
    setAiSource(data.aiSource ?? null);
    setQuotaAvailable(data.quotaAvailable !== false);
  }

  useEffect(() => { load().catch(() => setError("暂时无法加载内容，请刷新页面重试。")); }, []);

  async function parseDescription() {
    if (!description.trim()) { setError("请先写下你想持续关注的内容。 "); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/data-apps/intelligence-subscriptions/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, timezone: browserTimezone }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.plan) { setError(data.error ?? "请再补充关注对象或时间节奏，然后重试。 "); setBusy(false); return; }
    setPlan(data.plan);
    setBusy(false);
  }

  async function confirmPlan() {
    if (!plan) return;
    setBusy(true); setError("");
    const response = await fetch("/api/data-apps/intelligence-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan.task) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 402 || data.code === "quota_unavailable") setQuotaBlocked(true); setError(response.status === 402 ? "生成情报简报会消耗 AI 额度，请选择一种可用方式后再试。" : friendlyError(data.error ?? "")); setBusy(false); return; }
    setDescription(""); setPlan(null); await load(); setBusy(false);
  }

  function modifyDescription() {
    setPlan(null);
    window.setTimeout(() => descriptionRef.current?.focus(), 0);
  }

  function openAdvanced(task?: Task, seed?: Task) {
    setEditing(task ?? null);
    setAdvancedSeed(seed ?? null);
    setShowForm(true);
  }

  async function saveAdvanced(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const csv = (key: string) => String(form.get(key) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const executionMode = String(form.get("executionMode") ?? "manual") as "manual" | "scheduled";
    const rawStart = String(form.get("lookbackStart") ?? "");
    const rawEnd = String(form.get("lookbackEnd") ?? "");
    let lookbackPeriod: Task;
    try {
      lookbackPeriod = String(form.get("lookbackKind")) === "custom"
        ? { kind: "custom", start: rawStart ? new Date(rawStart).toISOString() : "", end: rawEnd ? new Date(rawEnd).toISOString() : "" }
        : { kind: "days", value: Number(form.get("lookbackKind") ?? 3) };
    } catch { setError("时间范围需要填写完整，请再试一次。 "); setBusy(false); return; }
    const payload = {
      name: String(form.get("name") ?? ""), topics: csv("topics"), entities: csv("entities"), keywords: csv("keywords"), regions: csv("regions"),
      includeRequirements: csv("includeRequirements"), excludeRequirements: csv("excludeRequirements"), maxItems: Number(form.get("maxItems") ?? 10),
      lookbackPeriod, outputInstructions: String(form.get("outputInstructions") ?? ""), executionMode,
      isActive: form.get("isActive") === "on",
      scheduleConfig: executionMode === "scheduled" ? { frequency: String(form.get("frequency") ?? "daily"), time: String(form.get("time") ?? "09:00"), timezone: String(form.get("timezone") ?? "Asia/Shanghai"), weekdays: [Number(form.get("weekday") ?? 1)] } : null,
    };
    const url = editing ? `/api/data-apps/intelligence-subscriptions/${editing.id}` : "/api/data-apps/intelligence-subscriptions";
    const response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(friendlyError(data.error ?? "")); setBusy(false); return; }
    setShowForm(false); setEditing(null); setAdvancedSeed(null); setPlan(null); await load(); setBusy(false);
  }

  async function action(task: Task, kind: "generate" | "delete" | "toggle") {
    setBusy(true); setError("");
    const url = `/api/data-apps/intelligence-subscriptions/${task.id}`;
    const response = kind === "generate"
      ? await fetch(`${url}/generate`, { method: "POST" })
      : kind === "delete"
        ? await fetch(url, { method: "DELETE" })
        : await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...task, isActive: !task.is_active, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, executionMode: task.execution_mode, scheduleConfig: task.schedule_config }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); if (response.status === 402 || data.code === "quota_unavailable") setQuotaBlocked(true); setError(response.status === 402 ? "生成情报简报会消耗 AI 额度，请选择一种可用方式后再试。" : friendlyError(data.error ?? "")); }
    await load(); setBusy(false);
  }

  async function markFeedback(briefId: string, itemKey: string, value: "valuable" | "irrelevant") {
    await fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey, feedback: value }) });
    setFeedback((previous) => ({ ...previous, [`${briefId}:${itemKey}`]: value }));
  }

  const current = useMemo(() => editing ?? advancedSeed ?? {}, [editing, advancedSeed]);
  const currentSchedule = scheduleOf(current);
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-ink">🧭 情报订制</h1><p className="mt-1 text-sm text-ink-soft">按你的关注范围、时间节奏和筛选标准，生成专属情报简报。</p></div>
    </div>
    {error && <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><p>{error}</p>{quotaBlocked && <div className="mt-3 flex flex-wrap gap-2"><a href="/settings/ai" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">配置 AI</a><a href="/org/workspace" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">升级机构版</a><a href="#my-intelligence-tasks" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">停用任务</a></div>}</div>}

    <section className="mt-6 rounded-lg border border-line bg-white p-5 sm:p-7">
      <h2 className="text-lg font-semibold text-ink">你想持续关注什么？</h2>
      <p className="mt-2 text-sm text-ink-soft">用一句话描述关注内容、频率和筛选要求，我们会帮你整理成情报任务。</p>
      <textarea ref={descriptionRef} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-5 min-h-32 w-full rounded-md border border-line px-4 py-3 text-sm outline-none focus:border-[#0D1B3E]" placeholder="例如：每周一上午9点，整理最近一周国内AI赛事，重点北京、有奖金、适合我的项目参赛，同一赛事合并，不超过20条。" />
      <div className="mt-3 flex flex-wrap items-center gap-3"><button onClick={parseDescription} disabled={busy} className="rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">生成订制方案</button><button onClick={() => openAdvanced()} className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft">高级设置</button></div>
      <div className="mt-5"><p className="text-xs text-ink-faint">可以从这些方向开始</p><div className="mt-2 flex flex-wrap gap-2">{templates.map((template) => <button key={template.label} onClick={() => { setDescription(template.text); setPlan(null); window.setTimeout(() => descriptionRef.current?.focus(), 0); }} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:border-[#0D1B3E]">{template.label}</button>)}</div></div>
    </section>

    {plan && <section className="mt-5 rounded-lg border border-[#cdd9e8] bg-[#f8fbff] p-5"><h2 className="text-base font-semibold text-ink">这是我整理的订制方案</h2>{plan.questions.length > 0 ? <><p className="mt-3 text-sm text-ink-soft">再补充一点信息，就能开始：</p><ul className="mt-2 list-disc pl-5 text-sm text-ink">{plan.questions.map((question) => <li key={question}>{question}</li>)}</ul><button onClick={modifyDescription} className="mt-4 rounded-md border border-line bg-white px-4 py-2 text-sm text-ink-soft">修改描述</button></> : <><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Summary label="任务名称" value={plan.task.name} /><Summary label="关注内容" value={summaryValue(plan.task)} /><Summary label="重点筛选条件" value={filtersValue(plan.task)} /><Summary label="时间范围" value={lookbackValue(plan.task.lookbackPeriod)} /><Summary label="信息数量" value={`最多 ${plan.task.maxItems} 条`} /><Summary label="生成方式" value={plan.task.executionMode === "scheduled" ? "定时生成" : "手动生成"} />{plan.task.executionMode === "scheduled" && <Summary label="定时频率与时间" value={scheduleValue(plan.task)} />}</div><div className="mt-5 flex flex-wrap gap-3"><button onClick={confirmPlan} disabled={busy} className="rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">确认创建</button><button onClick={modifyDescription} className="rounded-md border border-line bg-white px-4 py-2 text-sm text-ink-soft">修改描述</button><button onClick={() => openAdvanced(undefined, plan.task)} className="rounded-md border border-line bg-white px-4 py-2 text-sm text-ink-soft">高级调整</button></div></>}</section>}

    {showForm && <form onSubmit={saveAdvanced} className="mt-5 rounded-lg border border-line bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">高级设置</h2><button type="button" onClick={() => { setShowForm(false); setEditing(null); setAdvancedSeed(null); }} className="text-sm text-ink-faint">收起</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="任务名称" name="name" defaultValue={read(current, "name", "name")} required /><Field label="主题（逗号分隔）" name="topics" defaultValue={listValue(read(current, "topics", "topics", []))} /><Field label="主体或公司" name="entities" defaultValue={listValue(read(current, "entities", "entities", []))} /><Field label="关键词" name="keywords" defaultValue={listValue(read(current, "keywords", "keywords", []))} /><Field label="地域" name="regions" defaultValue={listValue(read(current, "regions", "regions", []))} /><Field label="包含条件" name="includeRequirements" defaultValue={listValue(read(current, "includeRequirements", "include_requirements", []))} /><Field label="排除条件" name="excludeRequirements" defaultValue={listValue(read(current, "excludeRequirements", "exclude_requirements", []))} /><Field label="最多条数" name="maxItems" type="number" defaultValue={read(current, "maxItems", "max_items", 10)} /><label className="text-sm text-ink-soft">时间范围<select name="lookbackKind" defaultValue={read(current, "lookbackPeriod", "lookback_period", {})?.kind === "custom" ? "custom" : String(read(current, "lookbackPeriod", "lookback_period", {})?.value ?? 3)} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="1">最近24小时</option><option value="3">最近3天</option><option value="7">最近7天</option><option value="custom">自定义</option></select></label><Field label="自定义开始时间" name="lookbackStart" type="datetime-local" defaultValue={localDateTime(read(current, "lookbackPeriod", "lookback_period", {})?.start ?? "")} /><Field label="自定义结束时间" name="lookbackEnd" type="datetime-local" defaultValue={localDateTime(read(current, "lookbackPeriod", "lookback_period", {})?.end ?? "")} /><label className="text-sm text-ink-soft sm:col-span-2">输出要求<textarea name="outputInstructions" defaultValue={read(current, "outputInstructions", "output_instructions", "")} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" placeholder="例如：区分事实与趋势，突出对项目的影响" /></label><label className="text-sm text-ink-soft">生成方式<select name="executionMode" defaultValue={read(current, "executionMode", "execution_mode", "manual")} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="manual">手动生成</option><option value="scheduled">定时生成</option></select></label><label className="flex items-end gap-2 pb-2 text-sm text-ink-soft"><input type="checkbox" name="isActive" defaultChecked={read(current, "isActive", "is_active", true) === true} /> 启用</label><label className="text-sm text-ink-soft">生成频率<select name="frequency" defaultValue={currentSchedule.frequency ?? "daily"} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="daily">每天</option><option value="weekly">每周</option></select></label><Field label="生成时间" name="time" type="time" defaultValue={currentSchedule.time ?? "09:00"} /><Field label="时区" name="timezone" defaultValue={currentSchedule.timezone ?? browserTimezone} /><Field label="星期（0=周日，1=周一）" name="weekday" type="number" defaultValue={currentSchedule.weekdays?.[0] ?? 1} /></div><button disabled={busy} className="mt-4 rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">保存设置</button></form>}

    {tasks.length > 0 && <section id="my-intelligence-tasks" className="mt-7"><h2 className="text-base font-semibold">我的情报任务</h2><div className="mt-3 grid gap-3">{tasks.map((task) => { const blocked = quotaAvailable === false && task.is_active; return <div key={task.id} className="rounded-lg border border-line bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{task.name}</h3><p className="mt-1 text-xs text-ink-faint">{blocked ? "额度不足" : task.is_active ? "已启用" : "已停用"} · {task.execution_mode === "scheduled" ? `${task.schedule_config?.frequency === "weekly" ? "每周" : "每天"} ${task.schedule_config?.time ?? ""}` : "手动生成"}{task.last_generated_at ? ` · 最近生成 ${new Date(task.last_generated_at).toLocaleString("zh-CN")}` : ""}</p><p className="mt-1 text-xs text-ink-faint">AI 来源：{aiSource === "custom" ? "自有 API" : aiSource === "platform" ? "平台额度" : "暂不可用"}</p></div><div className="flex flex-wrap gap-3 text-xs"><button onClick={() => action(task, "generate")} className="text-accent">生成本期简报</button><button onClick={() => openAdvanced(task)} className="text-ink-soft">编辑设置</button><button onClick={() => action(task, "toggle")} className="text-ink-soft">{task.is_active ? "停用" : "启用"}</button><button onClick={() => action(task, "delete")} className="text-red-600">删除</button></div></div></div>; })}</div></section>}
    <section className="mt-7"><h2 className="text-base font-semibold">过去生成的简报</h2>{briefs.length === 0 ? <p className="mt-3 text-sm text-ink-faint">生成后的简报会保留在这里，方便回看。</p> : <div className="mt-3 space-y-5">{briefs.map((brief) => <div key={brief.id} className="rounded-xl border border-line bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4"><div><p className="text-base font-semibold text-ink">{brief.task_name}</p><p className="mt-1 text-xs text-ink-faint">覆盖 {new Date(brief.coverage_start).toLocaleDateString("zh-CN")} 至 {new Date(brief.coverage_end).toLocaleDateString("zh-CN")} · 生成于 {new Date(brief.generated_at).toLocaleString("zh-CN")}</p></div><span className="rounded-full bg-[#f1f5fb] px-2.5 py-1 text-xs text-ink-soft">共 {brief.item_count} 条</span></div>{brief.metadata?.overview && <div className="mt-4 rounded-lg bg-[#f8fbff] px-4 py-3 text-sm leading-6 text-ink-soft"><p className="text-xs font-medium text-ink">本期概览</p><p className="mt-1 whitespace-pre-wrap">{brief.metadata.overview}</p></div>}<div className="mt-4 space-y-4">{brief.important_facts?.length > 0 && <BriefSection title="重点动态" tone="blue" items={brief.important_facts} briefId={brief.id} feedback={feedback} onFeedback={markFeedback} />}{brief.trend_signals?.length > 0 && <BriefSection title="趋势观察" tone="amber" items={brief.trend_signals} briefId={brief.id} feedback={feedback} onFeedback={markFeedback} />}{brief.other_items?.filter((item: any) => item.isClue)?.length > 0 && <BriefSection title="值得继续跟踪" tone="amber" items={brief.other_items.filter((item: any) => item.isClue).slice(0, 4)} briefId={brief.id} feedback={feedback} onFeedback={markFeedback} />}{brief.other_items?.filter((item: any) => !item.isClue)?.length > 0 && <BriefSection title="其他动态" tone="gray" items={brief.other_items.filter((item: any) => !item.isClue)} briefId={brief.id} feedback={feedback} onFeedback={markFeedback} />}</div>{brief.source_list?.length > 0 && <div className="mt-5 border-t border-line pt-4"><p className="text-xs font-medium text-ink-soft">本期信息源</p><div className="mt-2 flex flex-wrap gap-2">{uniqueSources(brief.source_list).map((source: any) => <a key={`${source.source}-${source.url ?? ""}`} href={source.url ?? undefined} target={source.url ? "_blank" : undefined} rel={source.url ? "noreferrer" : undefined} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-[#0D1B3E]">{source.source}</a>)}</div></div>}</div>)}</div>}</section>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-ink-faint">{label}</p><p className="mt-1 text-sm text-ink">{value || "按你的描述整理"}</p></div>; }
function BriefSection({ title, tone, items, briefId, feedback, onFeedback }: { title: string; tone: "blue" | "amber" | "gray"; items: any[]; briefId: string; feedback: Record<string, string>; onFeedback: (briefId: string, itemKey: string, value: "valuable" | "irrelevant") => void }) {
  const toneClass = tone === "blue" ? "border-blue-100 bg-blue-50/40" : tone === "amber" ? "border-amber-100 bg-amber-50/40" : "border-line bg-[#fafafa]";
  return <section className={`rounded-lg border p-3 ${toneClass}`}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{title}</h3><span className="text-xs text-ink-faint">{items.length} 条</span></div><div className="mt-2 space-y-3">{items.map((item: any) => {
    const sources = sourceLabels(item);
    const publishedLabel = item.timeUnconfirmed || !item.publishedAt ? "时间未确认" : new Date(item.publishedAt).toLocaleDateString("zh-CN");
    const summary = item.summary || stripLegacyBriefMarkdown(item.content) || "暂无摘要";
    const primaryUrl = item.sourceUrl || item.sourceUrls?.[0] || null;
    const moreUrls = (item.sourceUrls || []).filter((url: string) => url && url !== primaryUrl);
    return <article key={item.id} className="rounded-md border border-white/80 bg-white p-3 shadow-sm">
      <h4 className="text-sm font-medium leading-6 text-ink">{item.title}</h4>
      <p className="mt-2 text-sm leading-6 text-ink-soft whitespace-pre-wrap">{summary}</p>
      {item.investmentNote ? <p className="mt-2 text-sm leading-6 text-ink"><span className="font-medium">投资观察：</span>{item.investmentNote}</p> : null}
      {item.isClue ? <p className="mt-2 text-xs text-amber-700"><span className="font-medium">线索：</span>{item.followUpReason || "待进一步确认"}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-xs text-ink-faint">{publishedLabel} · {sources.join(" / ")}{primaryUrl ? <> · <a href={primaryUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">原文</a></> : null}{moreUrls.length > 0 ? <> · <a href={moreUrls[0]} target="_blank" rel="noreferrer" className="text-accent hover:underline">更多来源</a></> : null}</p>
        <div className="flex gap-2 text-xs"><button onClick={() => onFeedback(briefId, item.id, "valuable")} className={feedback[`${briefId}:${item.id}`] === "valuable" ? "font-semibold text-accent" : "text-ink-faint"}>有价值</button><button onClick={() => onFeedback(briefId, item.id, "irrelevant")} className={feedback[`${briefId}:${item.id}`] === "irrelevant" ? "font-semibold text-red-600" : "text-ink-faint"}>无关</button></div>
      </div>
    </article>;
  })}</div></section>;
}
function sourceLabels(item: any): string[] {
  const raw = String(item.source || "").split(/;\s*/).map((part: string) => part.trim()).filter(Boolean);
  return [...new Set(raw)].slice(0, 4);
}
function stripLegacyBriefMarkdown(content?: string): string {
  if (!content) return "";
  return content
    .replace(/\*\*发生了什么\*\*[\s\S]*?(?=\*\*|$)/g, "")
    .replace(/\*\*为什么值得关注\*\*[\s\S]*?(?=\*\*|$)/g, "")
    .replace(/\*\*可信度\*\*[\s\S]*?(?=\*\*|$)/g, "")
    .replace(/\*\*时间\*\*[\s\S]*$/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
function uniqueSources(sources: any[]): any[] { const seen = new Set<string>(); return sources.filter((source) => { const key = `${source.source}-${source.url ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function summaryValue(task: Task): string { return [...(task.topics ?? []), ...(task.entities ?? []), ...(task.regions ?? [])].filter(Boolean).join("、") || "按你的描述整理"; }
function filtersValue(task: Task): string { return [...(task.includeRequirements ?? []), ...(task.excludeRequirements ?? []).map((item: string) => `排除${item}`)].filter(Boolean).join("；") || "按相关性整理"; }
function lookbackValue(value: Task): string { if (value?.kind === "custom") return "自定义时间范围"; if (value?.value === 1) return "最近24小时"; return `最近${value?.value ?? 3}天`; }
function scheduleValue(task: Task): string { const schedule = task.scheduleConfig ?? {}; const day = schedule.frequency === "weekly" ? `每周${(schedule.weekdays ?? [1]).map((value: number) => ["日", "一", "二", "三", "四", "五", "六"][value]).join("、")}` : "每天"; return `${day} ${schedule.time ?? "09:00"}（${schedule.timezone ?? "Asia/Shanghai"}）`; }
function Field({ label, name, defaultValue, type = "text", required = false }: { label: string; name: string; defaultValue?: string | number; type?: string; required?: boolean }) { return <label className="text-sm text-ink-soft">{label}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" /></label>; }
