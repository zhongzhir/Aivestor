"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Task = Record<string, any>;
type Brief = Record<string, any>;
type Plan = { task: Task; questions: string[] };
type TaskFeedback = { tone: "running" | "success" | "error"; message: string; briefId?: string };

const templates = [
  { label: "行业动态跟踪", text: "每周一上午9点，整理最近一周我关注行业的关键变化，区分重要事实和趋势，不超过10条。" },
  { label: "指定公司跟踪", text: "每天上午9点，整理最近3天指定公司的重要动态，优先保留融资、产品和经营变化，不超过10条。" },
  { label: "基金与机构动态", text: "每周一上午9点，整理最近一周重点基金与投资机构的投资和募资动态，不超过10条。" },
  { label: "政策与监管变化", text: "每周一上午9点，整理最近一周国内AI相关政策与监管变化，突出对项目判断的影响，不超过10条。" },
  { label: "AI赛事监测", text: "每周一上午9点，整理最近一周国内AI赛事，重点北京、有奖金、适合我的项目参赛，同一赛事合并，不超过20条。" },
  { label: "一次性研究", text: "研究最近一周我关注行业的关键变化，区分重要事实和趋势，不超过10条。" },
];

const listValue = (value: unknown) => Array.isArray(value) ? value.join(", ") : "";
const read = (task: Task, camel: string, snake: string, fallback: any = "") => task[camel] ?? task[snake] ?? fallback;
const scheduleOf = (task: Task) => read(task, "scheduleConfig", "schedule_config", null) ?? {};
function clampCustomEnd(task: Task): Task {
  const lp = read(task, "lookbackPeriod", "lookback_period", null);
  if (lp && typeof lp === "object" && (lp as any).kind === "custom" && (lp as any).end) {
    const end = new Date((lp as any).end);
    const nowDate = new Date();
    if (Number.isFinite(end.getTime()) && end.getTime() > nowDate.getTime()) {
      return { ...task, lookbackPeriod: { ...lp, end: nowDate.toISOString() } };
    }
  }
  return task;
}

function friendlyError(message: string): string {
  if (message.includes("时间") || message.includes("时区")) return "时间安排需要再确认一下，请修改描述后重试。";
  if (message.includes("任务名称")) return "请给这项关注起一个简短名称，然后再试一次。";
  return "暂时没有完成，请检查描述后重试。";
}

function responseError(status: number, message: unknown, fallback: string): string {
  const detail = typeof message === "string" ? message.trim() : "";
  if (status === 401) return "登录状态已失效，请重新登录后再试。";
  if (status === 403) return "当前账号没有创建情报任务的权限。";
  if (status === 402) return "生成情报简报会消耗 AI 额度，请选择一种可用方式后再试。";
  if (detail) return detail;
  return fallback;
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
  const [editing, setEditing] = useState<Task | null>(null);
  const [advancedSeed, setAdvancedSeed] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [aiSource, setAiSource] = useState<"custom" | "platform" | null>(null);
  const [quotaAvailable, setQuotaAvailable] = useState(true);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [taskFeedback, setTaskFeedback] = useState<Record<string, TaskFeedback>>({});
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
  useEffect(() => {
    if (!generatingTaskId) return;
    const timer = window.setInterval(() => setGenerationSeconds((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [generatingTaskId]);

  async function parseDescription() {
    if (!description.trim()) { setError("请先写下你想收集或研究的内容。 "); setNotice(""); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/data-apps/intelligence-subscriptions/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, timezone: browserTimezone }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.plan) { setError(responseError(response.status, data.error, "暂时无法理解这句话，请稍后重试。")); return; }
      const nextPlan = data.plan as Plan;
      await createTask(nextPlan);
    } catch {
      setError("解析暂时没有完成，请检查网络或稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createTask(candidate: Plan) {
    const response = await fetch("/api/data-apps/intelligence-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(clampCustomEnd(candidate.task)) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 402 || data.code === "quota_unavailable") setQuotaBlocked(true);
      setError(responseError(response.status, data.error, friendlyError(data.error ?? "")));
      return false;
    }
    setDescription(""); setNotice(creationAcknowledgement(candidate.task));
    await load().catch(() => setError("任务已创建，但列表刷新失败；请刷新页面查看任务。"));
    if (candidate.task.executionMode !== "scheduled" && data.task?.id) await action(data.task, "generate");
    return true;
  }

  function openAdvanced(task?: Task, seed?: Task) {
    setEditing(task ?? null);
    setAdvancedSeed(seed ?? null);
    setShowForm(true);
  }

  async function saveAdvanced(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const csv = (key: string) => String(form.get(key) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const executionMode = String(form.get("executionMode") ?? "manual") as "manual" | "scheduled";
    const rawStart = String(form.get("lookbackStart") ?? "");
    const rawEnd = String(form.get("lookbackEnd") ?? "");
    let lookbackPeriod: Task;
    try {
      lookbackPeriod = String(form.get("lookbackKind")) === "custom"
        ? (() => {
            const start = rawStart ? new Date(rawStart) : null;
            let end = rawEnd ? new Date(rawEnd) : null;
            const nowDate = new Date();
            if (end && Number.isFinite(end.getTime()) && end.getTime() > nowDate.getTime()) end = nowDate;
            return {
              kind: "custom",
              start: start && Number.isFinite(start.getTime()) ? start.toISOString() : "",
              end: end && Number.isFinite(end.getTime()) ? end.toISOString() : "",
            };
          })()
        : { kind: "days", value: Number(form.get("lookbackKind") ?? 3) };
    } catch { setError("时间范围需要填写完整，请再试一次。 "); setBusy(false); return; }
    try {
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
      if (!response.ok) { setError(responseError(response.status, data.error, friendlyError(data.error ?? ""))); return; }
      setShowForm(false); setEditing(null); setAdvancedSeed(null); setNotice(editing ? "任务设置已保存。" : "任务已创建，可以在下方任务列表中生成本期简报。 ");
      await load().catch(() => setError("设置已保存，但列表刷新失败；请刷新页面查看任务。"));
    } catch {
      setError("保存暂时没有完成，请检查网络或稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function action(task: Task, kind: "generate" | "delete" | "toggle") {
    const url = `/api/data-apps/intelligence-subscriptions/${task.id}`;
    if (kind === "delete" && !window.confirm(`确定删除“${task.name}”吗？已生成的历史简报不会被删除。`)) return;
    if (kind === "generate") {
      if (generatingTaskId) return;
      setGeneratingTaskId(task.id);
      setGenerationSeconds(0);
      setError(""); setNotice("");
      setTaskFeedback((previous) => ({ ...previous, [task.id]: { tone: "running", message: "正在检索并整理本期信息，通常需要 1–4 分钟。你可以停留在本页等待。" } }));
      try {
        const response = await fetch(`${url}/generate`, { method: "POST" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 402 || data.code === "quota_unavailable") setQuotaBlocked(true);
          setTaskFeedback((previous) => ({ ...previous, [task.id]: { tone: "error", message: responseError(response.status, data.error, friendlyError(data.error ?? "")) } }));
          return;
        }
        setTaskFeedback((previous) => ({ ...previous, [task.id]: { tone: "success", message: "本期简报已生成，可在下方直接查看。", briefId: data.brief?.id ?? data.id } }));
        await load().catch(() => setTaskFeedback((previous) => ({ ...previous, [task.id]: { tone: "success", message: "简报已生成，但列表刷新失败。请刷新页面后查看。" } })));
      } catch {
        setTaskFeedback((previous) => ({ ...previous, [task.id]: { tone: "error", message: "生成暂时没有完成，请检查网络后重试。" } }));
      } finally {
        setGeneratingTaskId(null);
      }
      return;
    }
    setBusy(true); setError("");
    try {
      const response = kind === "delete"
          ? await fetch(url, { method: "DELETE" })
          : await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...task, isActive: !task.is_active, includeRequirements: task.include_requirements, excludeRequirements: task.exclude_requirements, maxItems: task.max_items, lookbackPeriod: task.lookback_period, executionMode: task.execution_mode, scheduleConfig: task.schedule_config }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); if (response.status === 402 || data.code === "quota_unavailable") setQuotaBlocked(true); setError(responseError(response.status, data.error, friendlyError(data.error ?? ""))); }
      await load().catch(() => {});
    } catch {
      setError("操作暂时没有完成，请检查网络或稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function markFeedback(briefId: string, itemKey: string, value: "valuable" | "irrelevant") {
    await fetch(`/api/data-apps/intelligence-subscriptions/briefs/${briefId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey, feedback: value }) });
    setFeedback((previous) => ({ ...previous, [`${briefId}:${itemKey}`]: value }));
  }

  const current = useMemo(() => editing ?? advancedSeed ?? {}, [editing, advancedSeed]);
  const currentSchedule = scheduleOf(current);
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-ink">🧭 情报订制</h1><p className="mt-1 text-sm text-ink-soft">用一句话说清你关心什么，系统会整理成可持续跟踪的情报任务。</p></div>
    </div>
    {notice && <div role="status" className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>}
    {error && <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><p>{error}</p>{quotaBlocked && <div className="mt-3 flex flex-wrap gap-2"><a href="/settings/ai" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">配置 AI</a><a href="/org/workspace" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">升级机构版</a><a href="#my-intelligence-tasks" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs">停用任务</a></div>}</div>}

    <section className="mt-6 rounded-lg border border-line bg-white p-5 sm:p-7">
      <h2 className="text-lg font-semibold text-ink">一句话订制你的情报</h2>
      <p className="mt-2 text-sm text-ink-soft">说清关注对象、时间范围和重点即可，其余由系统整理。一次性研究和持续跟踪都可以。</p>
      <textarea ref={descriptionRef} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-5 min-h-24 w-full rounded-md border border-line px-4 py-3 text-sm outline-none focus:border-[#0D1B3E]" placeholder="例如：每周跟踪中国创新药海外 BD 交易，只保留已披露金额的事件，并说明对投资判断的影响。" />
      <div className="mt-3 flex flex-wrap items-center gap-3"><button onClick={parseDescription} disabled={busy} className="rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "正在理解并创建…" : "开始订制"}</button><button onClick={() => openAdvanced()} className="px-2 py-2 text-sm text-ink-faint hover:text-ink">需要更多控制？高级设置</button></div>
      <div className="mt-5"><p className="text-xs text-ink-faint">可以从这些方向开始</p><div className="mt-2 flex flex-wrap gap-2">{templates.map((template) => <button key={template.label} onClick={() => { setDescription(template.text); window.setTimeout(() => descriptionRef.current?.focus(), 0); }} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:border-[#0D1B3E]">{template.label}</button>)}</div></div>
    </section>

    {showForm && <form onSubmit={saveAdvanced} className="mt-5 rounded-lg border border-line bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">高级设置</h2><button type="button" onClick={() => { setShowForm(false); setEditing(null); setAdvancedSeed(null); }} className="text-sm text-ink-faint">收起</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="任务名称" name="name" defaultValue={read(current, "name", "name")} required /><Field label="主题（逗号分隔）" name="topics" defaultValue={listValue(read(current, "topics", "topics", []))} /><Field label="主体或公司" name="entities" defaultValue={listValue(read(current, "entities", "entities", []))} /><Field label="关键词" name="keywords" defaultValue={listValue(read(current, "keywords", "keywords", []))} /><Field label="地域" name="regions" defaultValue={listValue(read(current, "regions", "regions", []))} /><Field label="包含条件" name="includeRequirements" defaultValue={listValue(read(current, "includeRequirements", "include_requirements", []))} /><Field label="排除条件" name="excludeRequirements" defaultValue={listValue(read(current, "excludeRequirements", "exclude_requirements", []))} /><Field label="最多条数" name="maxItems" type="number" defaultValue={read(current, "maxItems", "max_items", 10)} /><label className="text-sm text-ink-soft">时间范围<select name="lookbackKind" defaultValue={read(current, "lookbackPeriod", "lookback_period", {})?.kind === "custom" ? "custom" : String(read(current, "lookbackPeriod", "lookback_period", {})?.value ?? 3)} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="1">最近24小时</option><option value="3">最近3天</option><option value="7">最近7天</option><option value="custom">自定义</option></select></label><Field label="自定义开始时间" name="lookbackStart" type="datetime-local" defaultValue={localDateTime(read(current, "lookbackPeriod", "lookback_period", {})?.start ?? "")} /><Field label="自定义结束时间" name="lookbackEnd" type="datetime-local" defaultValue={localDateTime(read(current, "lookbackPeriod", "lookback_period", {})?.end ?? "")} /><label className="text-sm text-ink-soft sm:col-span-2">输出要求<textarea name="outputInstructions" defaultValue={read(current, "outputInstructions", "output_instructions", "")} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" placeholder="例如：区分事实与趋势，突出对项目的影响" /></label><label className="text-sm text-ink-soft">生成方式<select name="executionMode" defaultValue={read(current, "executionMode", "execution_mode", "manual")} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="manual">手动生成</option><option value="scheduled">定时生成</option></select></label><label className="flex items-end gap-2 pb-2 text-sm text-ink-soft"><input type="checkbox" name="isActive" defaultChecked={read(current, "isActive", "is_active", true) === true} /> 启用</label><label className="text-sm text-ink-soft">生成频率<select name="frequency" defaultValue={currentSchedule.frequency ?? "weekly"} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm"><option value="daily">每天</option><option value="weekly">每周</option></select></label><Field label="生成时间" name="time" type="time" defaultValue={currentSchedule.time ?? "08:00"} /><Field label="时区" name="timezone" defaultValue={currentSchedule.timezone ?? browserTimezone} /><label className="text-sm text-ink-soft">每周哪天<select name="weekday" defaultValue={currentSchedule.weekdays?.[0] ?? 5} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm">{["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((label, value) => <option key={value} value={value}>{label}</option>)}</select></label></div><button type="submit" disabled={busy} className="mt-4 rounded-md bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">保存设置</button>{error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}</form>}

    {tasks.length > 0 && <section id="my-intelligence-tasks" className="mt-7"><h2 className="text-base font-semibold">我的情报任务</h2><div className="mt-3 grid gap-3">{tasks.map((task) => {
      const blocked = quotaAvailable === false && task.is_active;
      const isGenerating = generatingTaskId === task.id;
      const status = taskFeedback[task.id];
      return <div key={task.id} className={`rounded-lg border bg-white p-4 ${isGenerating ? "border-blue-300 shadow-sm" : "border-line"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{task.name}</h3><p className="mt-1 text-xs text-ink-faint">{blocked ? "额度不足" : task.is_active ? "已启用" : "已停用"} · {task.execution_mode === "scheduled" ? scheduleValue(task) : "需要时生成"}{task.last_generated_at ? ` · 最近生成 ${new Date(task.last_generated_at).toLocaleString("zh-CN")}` : ""}</p><p className="mt-1 text-xs text-ink-faint">AI 来源：{aiSource === "custom" ? "自有 API" : aiSource === "platform" ? "平台额度" : "暂不可用"}</p></div><div className="flex flex-wrap gap-3 text-xs"><button onClick={() => action(task, "generate")} disabled={Boolean(generatingTaskId) || busy} className="font-medium text-accent disabled:text-ink-faint">{isGenerating ? `生成中 ${formatElapsed(generationSeconds)}` : "生成本期简报"}</button><button onClick={() => openAdvanced(task)} disabled={isGenerating} className="text-ink-soft disabled:text-ink-faint">编辑设置</button><button onClick={() => action(task, "toggle")} disabled={isGenerating} className="text-ink-soft disabled:text-ink-faint">{task.is_active ? "停用" : "启用"}</button><button onClick={() => action(task, "delete")} disabled={isGenerating} className="text-red-600 disabled:text-ink-faint">删除</button></div></div>{status && <div role={status.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-md px-3 py-2 text-xs ${status.tone === "running" ? "bg-blue-50 text-blue-800" : status.tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}><span>{status.tone === "running" ? "● " : status.tone === "success" ? "✓ " : ""}{status.message}</span>{status.tone === "success" && <a href="#latest-intelligence-brief" className="ml-2 font-medium underline">查看结果</a>}{status.tone === "error" && <button onClick={() => action(task, "generate")} disabled={Boolean(generatingTaskId)} className="ml-2 font-medium underline disabled:opacity-50">重新生成</button>}</div>}</div>;
    })}</div></section>}
    <section className="mt-7"><h2 className="text-base font-semibold">过去生成的简报</h2>{briefs.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-center text-sm text-ink-faint">还没有简报。点击任务中的“生成本期简报”，结果会保留在这里。</p> : <div className="mt-3 space-y-3">{briefs.map((brief, index) => <BriefCard key={brief.id} brief={brief} isLatest={index === 0} feedback={feedback} onFeedback={markFeedback} />)}</div>}</section>
  </div>;
}

function BriefCard({ brief, isLatest, feedback, onFeedback }: { brief: Brief; isLatest: boolean; feedback: Record<string, string>; onFeedback: (briefId: string, itemKey: string, value: "valuable" | "irrelevant") => void }) {
  const facts = brief.important_facts ?? [];
  const trends = brief.trend_signals ?? [];
  const clues = (brief.other_items ?? []).filter((item: any) => item.isClue);
  const other = (brief.other_items ?? []).filter((item: any) => !item.isClue);
  const overview = String(brief.metadata?.overview ?? "").trim();
  const preview = compactText(overview, 320);
  const hasMoreItems = [facts, trends, clues, other].some((items) => items.length > 3);
  return <details id={isLatest ? "latest-intelligence-brief" : undefined} open={isLatest} className="group rounded-xl border border-line bg-white">
    <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4 marker:content-none sm:p-5"><div><div className="flex items-center gap-2"><p className="text-base font-semibold text-ink">{brief.task_name}</p>{isLatest && <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[10px] font-medium text-accent">最新</span>}</div><p className="mt-1 text-xs text-ink-faint">覆盖 {new Date(brief.coverage_start).toLocaleDateString("zh-CN")} 至 {new Date(brief.coverage_end).toLocaleDateString("zh-CN")} · 生成于 {new Date(brief.generated_at).toLocaleString("zh-CN")}</p></div><span className="flex items-center gap-2"><span className="rounded-full bg-[#f1f5fb] px-2.5 py-1 text-xs text-ink-soft">共 {brief.item_count} 条</span><span className="text-xs text-ink-faint group-open:hidden">展开</span><span className="hidden text-xs text-ink-faint group-open:inline">收起</span></span></summary>
    <div className="border-t border-line px-4 pb-5 sm:px-5">
      {brief.metadata?.retrieval?.status === "partial" && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">部分公开来源暂时无法访问。本期只展示可核验结果，建议稍后重新生成。</div>}
      {overview && <div className="mt-4 rounded-lg bg-[#f8fbff] px-4 py-3 text-sm leading-6 text-ink-soft"><p className="text-xs font-medium text-ink">本期结论</p><p className="mt-1 whitespace-pre-wrap">{preview}</p>{overview !== preview && <details className="mt-2"><summary className="cursor-pointer text-xs text-accent">查看完整研究结论</summary><p className="mt-2 whitespace-pre-wrap border-t border-blue-100 pt-2">{overview}</p></details>}</div>}
      {brief.item_count === 0 && <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center"><p className="text-sm font-medium text-ink">本期没有达到发布标准的新事件</p><p className="mt-1 text-xs text-ink-faint">系统不会把“没有发生事件”或窗口外旧闻当作新动态发布。</p></div>}
      <div className="mt-4 space-y-4">{facts.length > 0 && <BriefSection title="重点动态" tone="blue" items={facts.slice(0, 3)} total={facts.length} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{trends.length > 0 && <BriefSection title="趋势观察" tone="amber" items={trends.slice(0, 3)} total={trends.length} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{clues.length > 0 && <BriefSection title="待核实线索" tone="amber" items={clues.slice(0, 3)} total={clues.length} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{other.length > 0 && <BriefSection title="其他动态" tone="gray" items={other.slice(0, 3)} total={other.length} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}</div>
      {hasMoreItems && <details className="mt-4 rounded-lg border border-line px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-accent">查看其余结果</summary><div className="mt-3 space-y-4">{facts.length > 3 && <BriefSection title="其余重点动态" tone="blue" items={facts.slice(3)} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{trends.length > 3 && <BriefSection title="其余趋势观察" tone="amber" items={trends.slice(3)} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{clues.length > 3 && <BriefSection title="其余待核实线索" tone="amber" items={clues.slice(3)} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}{other.length > 3 && <BriefSection title="其余动态" tone="gray" items={other.slice(3)} briefId={brief.id} feedback={feedback} onFeedback={onFeedback} />}</div></details>}
      {brief.source_list?.length > 0 && <details className="mt-5 border-t border-line pt-4"><summary className="cursor-pointer text-xs font-medium text-ink-soft">查看本期信息源（{uniqueSources(brief.source_list).length}）</summary><div className="mt-3 flex flex-wrap gap-2">{uniqueSources(brief.source_list).map((source: any) => <a key={`${source.source}-${source.url ?? ""}`} href={source.url ?? undefined} target={source.url ? "_blank" : undefined} rel={source.url ? "noreferrer" : undefined} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-[#0D1B3E]">{source.source}</a>)}</div></details>}
    </div>
  </details>;
}
function BriefSection({ title, tone, items, total = items.length, briefId, feedback, onFeedback }: { title: string; tone: "blue" | "amber" | "gray"; items: any[]; total?: number; briefId: string; feedback: Record<string, string>; onFeedback: (briefId: string, itemKey: string, value: "valuable" | "irrelevant") => void }) {
  const toneClass = tone === "blue" ? "border-blue-100 bg-blue-50/40" : tone === "amber" ? "border-amber-100 bg-amber-50/40" : "border-line bg-[#fafafa]";
  const relevanceRank = (value?: string) => value === "high" ? 2 : value === "medium" ? 1 : 0;
  const sortedItems = [...items].sort((a: any, b: any) => relevanceRank(b.relevance) - relevanceRank(a.relevance));
  return <section className={`rounded-lg border p-3 ${toneClass}`}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{title}</h3><span className="text-xs text-ink-faint">{total} 条</span></div><div className="mt-2 space-y-3">{sortedItems.map((item: any) => {
    const sources = sourceLabels(item);
    const publishedLabel = item.timeUnconfirmed || !item.publishedAt ? "时间未确认" : new Date(item.publishedAt).toLocaleDateString("zh-CN");
    const summary = item.summary || stripLegacyBriefMarkdown(item.content) || "暂无摘要";
    const primaryUrl = item.sourceUrl || item.sourceUrls?.[0] || null;
    const moreUrls = (item.sourceUrls || []).filter((url: string) => url && url !== primaryUrl);
    return <article key={item.id} className="rounded-md border border-white/80 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-6 text-ink">{item.title}</h4>
        <span className="flex shrink-0 items-center gap-1.5">{item.relevance === "high" ? <span className="rounded bg-[#eef4ff] px-1.5 py-0.5 text-[10px] font-medium text-accent">与你相关</span> : null}<TierBadge tier={item.sourceTier} /></span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-soft whitespace-pre-wrap">{summary}</p>
      {item.investmentNote ? <p className="mt-2 text-sm leading-6 text-ink"><span className="font-medium">投资观察：</span>{item.investmentNote}</p> : null}
      {item.relevanceReason ? <p className="mt-2 text-xs leading-5 text-accent"><span className="font-medium">为什么值得关注：</span>{compactText(item.relevanceReason, 140)}</p> : null}
      {item.isClue ? <p className="mt-2 text-xs text-amber-700"><span className="font-medium">还需确认：</span>{compactText(item.followUpReason || "需找到更直接的信息源或事件日期。", 120)}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-xs text-ink-faint">{item.timeUnconfirmed ? <span className="text-ink-faint">时间未确认</span> : publishedLabel} · {sources.join(" / ")}{primaryUrl ? <> · <a href={primaryUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">原文</a></> : null}{moreUrls.length > 0 ? <> · <a href={moreUrls[0]} target="_blank" rel="noreferrer" className="text-accent hover:underline">更多来源</a></> : null}{item.evidenceStatus === "partial" ? <> · <span className="text-amber-600">部分核验</span></> : item.evidenceStatus === "unavailable" ? <> · <span className="text-ink-faint">仅摘要</span></> : null}</p>
        <div className="flex gap-2 text-xs"><button onClick={() => onFeedback(briefId, item.id, "valuable")} className={feedback[`${briefId}:${item.id}`] === "valuable" ? "font-semibold text-accent" : "text-ink-faint"}>有价值</button><button onClick={() => onFeedback(briefId, item.id, "irrelevant")} className={feedback[`${briefId}:${item.id}`] === "irrelevant" ? "font-semibold text-red-600" : "text-ink-faint"}>无关</button></div>
      </div>
    </article>;
  })}</div></section>;
}
function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const label = tier === "S" ? "官方" : tier === "A" ? "专业" : tier === "B" ? "媒体" : tier === "C" ? "门户" : "其他";
  const cls = tier === "S"
    ? "bg-[#e7f5ec] text-[#1f7a44]"
    : tier === "A"
      ? "bg-[#eef4ff] text-accent"
      : "bg-[#f5f3ee] text-ink-soft";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
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
function compactText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}
function uniqueSources(sources: any[]): any[] { const seen = new Set<string>(); return sources.filter((source) => { const key = `${source.source}-${source.url ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function scheduleValue(task: Task): string { const schedule = scheduleOf(task); const day = schedule.frequency === "weekly" ? `每周${(schedule.weekdays ?? [5]).map((value: number) => ["日", "一", "二", "三", "四", "五", "六"][value]).join("、")}` : "每天"; return `${day}${friendlyTime(schedule.time ?? "08:00")}`; }
function friendlyTime(value: string): string { const [hourText, minuteText] = value.split(":"); const hour = Number(hourText); const minute = Number(minuteText || 0); const period = hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上"; const displayHour = hour > 12 ? hour - 12 : hour || 12; return `${period}${displayHour}点${minute ? `${minute}分` : ""}`; }
function creationAcknowledgement(task: Task): string { return task.executionMode === "scheduled" ? `好的，我理解了你要“${task.name}”。以后${scheduleValue(task)}会为你整理，任务已经开始运行。` : `好的，我理解了你要“${task.name}”。任务已创建，正在为你生成第一份简报。`; }
function Field({ label, name, defaultValue, type = "text", required = false }: { label: string; name: string; defaultValue?: string | number; type?: string; required?: boolean }) { return <label className="text-sm text-ink-soft">{label}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 block w-full rounded border border-line px-3 py-2 text-sm" /></label>; }
