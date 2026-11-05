"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calendarRangeInTimeZone, localCalendarDate } from "@/lib/intelligenceCalendar";
import { IntelligenceBriefReader } from "./IntelligenceBriefReader";
import { topicPayload, type IntelligenceBrief, type IntelligenceRun, type IntelligenceTopic, type SchedulerStatus } from "./intelligenceTypes";

type Tab = "latest" | "history" | "scope" | "runs";
const TERMINAL = new Set(["succeeded", "partial", "no_new_items", "failed", "blocked", "cancelled"]);

function date(value?: string | null) {
  if (!value) return "未设置";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("zh-CN") : "未设置";
}

function day(value?: string | null) {
  if (!value) return "未设置";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("zh-CN") : "未设置";
}

function calendarInput(value: string | undefined, timeZone: string) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? localCalendarDate(parsed, timeZone) : "";
}

function statusLabel(status?: string | null) {
  return ({ queued: "等待运行", running: "运行中", succeeded: "完成", partial: "部分完成", no_new_items: "无新事件", failed: "失败", blocked: "受阻", cancelled: "已取消" } as Record<string, string>)[status ?? ""] ?? "尚未执行";
}

export function IntelligenceTopicView({ topicId, scheduler, quotaAvailable, aiSource, aiProvider, onBack, onChanged }: {
  topicId: string;
  scheduler: SchedulerStatus;
  quotaAvailable: boolean;
  aiSource: "custom" | "platform" | null;
  aiProvider: string | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [topic, setTopic] = useState<IntelligenceTopic | null>(null);
  const [briefs, setBriefs] = useState<IntelligenceBrief[]>([]);
  const [runs, setRuns] = useState<IntelligenceRun[]>([]);
  const [briefCursor, setBriefCursor] = useState<string | null>(null);
  const [runCursor, setRunCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("latest");
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  const [authorizeCustomDeepSeek, setAuthorizeCustomDeepSeek] = useState(false);

  const load = useCallback(async () => {
    try {
      const [topicResponse, briefResponse, runResponse] = await Promise.all([
        fetch(`/api/data-apps/intelligence-subscriptions/${topicId}`, { cache: "no-store" }),
        fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/briefs?limit=10`, { cache: "no-store" }),
        fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/runs?limit=15`, { cache: "no-store" }),
      ]);
      const [topicBody, briefBody, runBody] = await Promise.all([topicResponse.json(), briefResponse.json(), runResponse.json()]);
      if (!topicResponse.ok) throw new Error(topicBody.error || "加载主题失败");
      if (!briefResponse.ok) throw new Error(briefBody.error || "加载历史简报失败");
      if (!runResponse.ok) throw new Error(runBody.error || "加载运行记录失败");
      setTopic(topicBody.task);
      setBriefs(briefBody.briefs ?? []);
      setRuns(runBody.runs ?? []);
      setBriefCursor(briefBody.nextCursor ?? null);
      setRunCursor(runBody.nextCursor ?? null);
      setError("");
      const latestRun = runBody.runs?.[0] as IntelligenceRun | undefined;
      if (latestRun && TERMINAL.has(latestRun.status)) localStorage.removeItem(`intelligence:pending:${topicId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载主题失败");
    }
  }, [topicId]);

  useEffect(() => { load(); }, [load]);
  const latestRun = runs[0] ?? null;
  useEffect(() => {
    const awaitingScheduledRun = !!topic && topic.is_active && topic.execution_mode === "scheduled" && !latestRun;
    if (!awaitingScheduledRun && (!latestRun || !["queued", "running"].includes(latestRun.status))) return;
    const timer = window.setInterval(load, 2_500);
    return () => window.clearInterval(timer);
  }, [latestRun, load, topic]);

  useEffect(() => {
    if (!operationMessage || !latestRun) return;
    if (latestRun.status === "queued") setOperationMessage("已加入队列，等待后台研究开始。关闭页面不会中断运行。");
    else if (latestRun.status === "running") setOperationMessage(`正在研究：${latestRun.checkpoint_stage ? pipelineStageLabel(latestRun.checkpoint_stage) : "准备中"}。关闭页面不会中断运行。`);
    else if (["succeeded", "partial", "no_new_items"].includes(latestRun.status)) setOperationMessage(`本次运行${statusLabel(latestRun.status)}，成果和来源已保存。`);
    else if (["failed", "blocked", "cancelled"].includes(latestRun.status)) setOperationMessage(`本次运行${statusLabel(latestRun.status)}：${latestRun.error_message_safe || "请查看运行记录。"}`);
  }, [latestRun, operationMessage]);

  const selectedBrief = useMemo(() => {
    const explicit = briefs.find((brief) => brief.id === selectedBriefId);
    if (explicit) return explicit;
    if (latestRun && ["failed", "blocked"].includes(latestRun.status)) {
      return briefs.find((brief) => brief.run_status !== "failed" && brief.run_status !== "blocked") ?? briefs[0] ?? null;
    }
    return briefs[0] ?? null;
  }, [briefs, selectedBriefId, latestRun]);

  async function runOnce() {
    if (!topic || busy) return;
    const requiresCustomDeepSeekAuthorization = aiSource === "custom" && aiProvider === "deepseek";
    if (requiresCustomDeepSeekAuthorization && !authorizeCustomDeepSeek) return;
    if (requiresCustomDeepSeekAuthorization && !window.confirm("确认本次使用你在设置中保存的 DeepSeek，并按单次 USD 0.10 硬上限执行？")) return;
    setBusy(true);
    setError("");
    setOperationMessage("正在创建运行记录…");
    setTab("latest");
    try {
      const storageKey = `intelligence:pending:${topic.id}`;
      const key = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, key);
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/${topic.id}/generate`, {
        method: "POST",
        headers: { "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify(requiresCustomDeepSeekAuthorization ? {
          authorizeDeepSeekSearch: true,
          authorizeDeepSeekGeneration: true,
          deepSeekOnly: true,
        } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "无法创建运行记录");
      if (body.run) setRuns((current) => [body.run as IntelligenceRun, ...current.filter((run) => run.id !== body.run.id)]);
      setAuthorizeCustomDeepSeek(false);
      setOperationMessage("已加入队列，等待后台研究开始。关闭页面不会中断运行。");
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "无法创建运行记录";
      setError(message);
      setOperationMessage(`未能开始运行：${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!topic || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/${topic.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(topicPayload(topic, { isActive: !topic.is_active })),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "更新失败");
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!topic || busy || !window.confirm(`归档“${topic.name}”？历史简报和运行记录会保留。`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/${topic.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "归档失败");
      await onChanged();
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "归档失败");
    } finally {
      setBusy(false);
    }
  }

  async function retry(run: IntelligenceRun) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/runs/${run.id}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "无法重试");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法重试");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(kind: "briefs" | "runs") {
    const cursor = kind === "briefs" ? briefCursor : runCursor;
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/${kind}?limit=10&cursor=${encodeURIComponent(cursor)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "加载失败");
      if (kind === "briefs") {
        setBriefs((current) => [...current, ...(body.briefs ?? [])]);
        setBriefCursor(body.nextCursor ?? null);
      } else {
        setRuns((current) => [...current, ...(body.runs ?? [])]);
        setRunCursor(body.nextCursor ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }

  if (!topic) {
    return <div><button type="button" onClick={onBack} className="text-sm text-ink-faint">← 情报工作空间</button>{error ? <p role="alert" className="mt-5 text-sm text-red-700">{error}</p> : <p className="mt-5 text-sm text-ink-faint">正在加载主题…</p>}</div>;
  }
  const archived = !!topic.archived_at;
  const requiresCustomDeepSeekAuthorization = aiSource === "custom" && aiProvider === "deepseek";

  return (
    <div>
      <button type="button" onClick={onBack} className="text-sm text-ink-faint hover:text-ink">← 情报工作空间</button>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">{topic.name}</h1>
            <span className={`rounded px-2 py-1 text-[11px] ${topic.is_active && !archived ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{archived ? "已归档" : topic.is_active ? "已启用" : "已暂停"}</span>
          </div>
          <p className="mt-2 text-sm text-ink-soft">{[...topic.regions, ...topic.topics, ...topic.entities, ...topic.event_types].filter(Boolean).join(" · ") || "自定义投资情报主题"}</p>
        </div>
        {archived ? <p className="text-sm text-ink-faint">只读查看；请在情报工作空间的“已归档主题”中恢复。</p> : <div className="flex max-w-xl flex-wrap justify-end gap-2">
          <p className={`w-full text-right text-xs ${quotaAvailable ? "text-ink-faint" : "text-red-700"}`}>
            {quotaAvailable ? (aiSource === "platform" ? "默认使用系统赠送的 AI 额度" : "使用账户中已配置的 AI") : "当前没有可用的系统额度或 AI 配置"}
          </p>
          {requiresCustomDeepSeekAuthorization ? <label className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft"><span className="flex items-start gap-2"><input type="checkbox" checked={authorizeCustomDeepSeek} onChange={(event) => setAuthorizeCustomDeepSeek(event.target.checked)} disabled={busy || !topic.is_active} className="mt-0.5" /><span>系统赠送额度当前不可用；本次改用我在设置中保存的 DeepSeek（单次费用上限 USD 0.10）</span></span></label> : null}
          <button type="button" onClick={runOnce} disabled={busy || !quotaAvailable || (requiresCustomDeepSeekAuthorization && !authorizeCustomDeepSeek) || !topic.is_active || latestRun?.status === "queued" || latestRun?.status === "running"} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "正在提交…" : latestRun?.status === "queued" || latestRun?.status === "running" ? "运行中…" : "运行一次"}</button>
          <button type="button" onClick={() => setTab("scope")} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-soft">编辑范围</button>
          <button type="button" onClick={toggleActive} disabled={busy} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-soft">{topic.is_active ? "暂停" : "恢复"}</button>
          <button type="button" onClick={archive} disabled={busy} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-faint">归档</button>
        </div>}
      </div>

      <RunStatusStrip run={latestRun} topic={topic} scheduler={scheduler} onRetry={retry} canRetry={!archived && topic.is_active} />
      {operationMessage && <div aria-live="polite" className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{operationMessage}</div>}
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mt-6 flex gap-5 overflow-x-auto border-b border-line" role="tablist" aria-label="主题内容">
        {(["latest", "history", "scope", "runs"] as Tab[]).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`shrink-0 border-b-2 px-1 pb-3 text-sm ${tab === value ? "border-accent font-medium text-ink" : "border-transparent text-ink-faint"}`}>
            {{ latest: "最新", history: "历史", scope: "范围与计划", runs: "运行记录" }[value]}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "latest" && (
          selectedBrief ? (
            <>
              {latestRun && ["failed", "blocked"].includes(latestRun.status) && selectedBrief.run_id !== latestRun.id ? (
                <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">本次运行未完成；下方继续展示最近一次成功成果。</div>
              ) : null}
              <IntelligenceBriefReader brief={selectedBrief} />
            </>
          ) : <EmptyLatest run={latestRun} onRun={runOnce} disabled={!quotaAvailable || !topic.is_active || busy} readOnly={archived} />
        )}
        {tab === "history" && <BriefHistory briefs={briefs} onOpen={(id) => { setSelectedBriefId(id); setTab("latest"); }} nextCursor={briefCursor} onLoadMore={() => loadMore("briefs")} />}
        {tab === "scope" && <TopicScope topic={topic} onSaved={load} readOnly={archived} />}
        {tab === "runs" && <RunHistory runs={runs} onRetry={retry} canRetry={!archived && topic.is_active} nextCursor={runCursor} onLoadMore={() => loadMore("runs")} />}
      </div>
    </div>
  );
}

function RunStatusStrip({ run, topic, scheduler, onRetry, canRetry }: { run: IntelligenceRun | null; topic: IntelligenceTopic; scheduler: SchedulerStatus; onRetry: (run: IntelligenceRun) => void; canRetry: boolean }) {
  const tone = run?.status === "failed" || run?.status === "blocked" ? "border-red-200 bg-red-50 text-red-800" : run?.status === "partial" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-surface text-ink-soft";
  return (
    <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">最近一次：{statusLabel(run?.status)}</p>
          {run?.status === "queued" ? <p className="mt-1 text-xs leading-5">已加入队列，等待后台研究开始；关闭页面不会中断。</p> : null}
          {run?.status === "running" && run.checkpoint_stage ? <p className="mt-1 text-xs leading-5">当前阶段：{pipelineStageLabel(run.checkpoint_stage)}{run.checkpoint_status === "partial" ? "（部分完成）" : ""}</p> : null}
          <p className="mt-1 text-xs leading-5">
            {run ? `${day(run.coverage_start)} 至 ${day(run.coverage_end)}${run.finished_at ? ` · 完成于 ${date(run.finished_at)}` : run.started_at ? ` · 开始于 ${date(run.started_at)}` : ""}` : "还没有运行记录。"}
          </p>
          {run?.error_message_safe && <p className="mt-1 text-xs leading-5">{run.error_message_safe}</p>}
          {run?.requires_fresh_authorization && ["failed", "blocked"].includes(run.status) ? (
            <p className="mt-1 text-xs leading-5">这是旧版单次授权运行，不能直接重放。点击顶部“运行一次”会按当前账户的默认 AI 额度创建新记录。</p>
          ) : null}
          {run?.status === "partial" && <p className="mt-1 text-xs leading-5">本次仅发布通过来源与结构校验的事项；未通过部分已隔离，来源和运行记录仍保留。</p>}
          {topic.execution_mode === "scheduled" && (
            <p className="mt-1 text-xs leading-5">
              {scheduler.healthy && topic.next_run_at ? `下次计划：${date(topic.next_run_at)} · ${topic.schedule_config?.timezone ?? ""}` : "已配置自动计划，但当前无法确认调度服务状态。"}
            </p>
          )}
        </div>
        {canRetry && run && !run.requires_fresh_authorization && ["failed", "blocked"].includes(run.status) ? <button type="button" onClick={() => onRetry(run)} className="text-xs font-medium underline">重试本次运行</button> : null}
      </div>
    </div>
  );
}

function EmptyLatest({ run, onRun, disabled, readOnly = false }: { run: IntelligenceRun | null; onRun: () => void; disabled: boolean; readOnly?: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{run?.status === "queued" || run?.status === "running" ? "研究正在后台进行" : "还没有可查看的简报"}</p>
      <p className="mt-2 text-sm text-ink-soft">{readOnly ? "这个归档主题没有可查看的成果；恢复后可重新运行。" : run?.status === "queued" || run?.status === "running" ? "关闭页面不会中断，稍后返回即可恢复状态。" : "运行一次后，成果会持久保存在当前主题历史中。"}</p>
      {!readOnly && (!run || TERMINAL.has(run.status)) ? <button type="button" onClick={onRun} disabled={disabled} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">运行一次</button> : null}
    </div>
  );
}

function BriefHistory({ briefs, onOpen, nextCursor, onLoadMore }: { briefs: IntelligenceBrief[]; onOpen: (id: string) => void; nextCursor: string | null; onLoadMore: () => void }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">历史简报</h2>
      {briefs.length === 0 ? <p className="mt-4 text-sm text-ink-faint">当前主题还没有历史简报。</p> : <div className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">{briefs.map((brief) => (
        <button key={brief.id} type="button" onClick={() => onOpen(brief.id)} className="flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-surface sm:flex-row sm:items-center sm:justify-between">
          <span><span className="text-sm font-medium text-ink">{new Date(brief.generated_at).toLocaleString("zh-CN")}</span><span className="ml-2 text-xs text-ink-faint">{statusLabel(brief.run_status || (brief.item_count === 0 ? "no_new_items" : "succeeded"))}</span></span>
          <span className="text-xs text-ink-faint">{day(brief.coverage_start)}–{day(brief.coverage_end)} · {brief.item_count} 条事件 · 打开</span>
        </button>
      ))}</div>}
      {nextCursor && <button type="button" onClick={onLoadMore} className="mt-4 text-sm text-accent hover:underline">加载更多</button>}
    </section>
  );
}

function TopicScope({ topic, onSaved, readOnly = false }: { topic: IntelligenceTopic; onSaved: () => Promise<void>; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suspicious = topic.lookback_period.kind === "custom" && topic.lookback_period.end && new Date(topic.created_at).getTime() - new Date(topic.lookback_period.end).getTime() > 86_400_000;
  const topicTimeZone = topic.schedule_config?.timezone || "Asia/Shanghai";
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("lookbackKind"));
    const start = String(form.get("start") || "");
    const end = String(form.get("end") || "");
    const mode = String(form.get("executionMode")) === "scheduled" ? "scheduled" : "manual";
    const timeZone = String(form.get("timezone") || topic.schedule_config?.timezone || "Asia/Shanghai");
    let lookbackPeriod;
    try {
      lookbackPeriod = kind === "custom"
        ? { kind: "custom", ...calendarRangeInTimeZone(start, end, timeZone) }
        : { kind: "days", value: Number(form.get("days") || 7) };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "日期范围无效");
      return;
    }
    const frequency = String(form.get("frequency")) === "daily" ? "daily" : "weekly";
    const weekdays = form.getAll("weekdays").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (mode === "scheduled" && frequency === "weekly" && weekdays.length === 0) {
      setError("每周计划至少选择一天");
      return;
    }
    const scheduleConfig = mode === "scheduled" ? {
      frequency,
      weekdays: frequency === "daily" ? undefined : weekdays,
      time: String(form.get("time") || "08:00"),
      timezone: timeZone,
    } : null;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/data-apps/intelligence-subscriptions/${topic.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(topicPayload(topic, { lookbackPeriod, executionMode: mode, scheduleConfig, eventTypes: String(form.get("eventTypes") || "").split(/[,，]/).map((value) => value.trim()).filter(Boolean) })),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "保存失败");
      setEditing(false); await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }
  if (editing) return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <h2 className="text-base font-semibold text-ink">编辑未来运行设置</h2>
      <p className="text-sm text-ink-soft">修改只影响未来运行；历史简报和当时的范围快照不会改变。</p>
      <label className="block text-sm text-ink-soft">事件类型<input name="eventTypes" defaultValue={topic.event_types.join("，")} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
      <fieldset className="rounded-lg border border-line p-4"><legend className="px-1 text-sm font-medium text-ink">查询窗口</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="text-sm"><select name="lookbackKind" defaultValue={topic.lookback_period.kind} className="w-full rounded-lg border border-line px-3 py-2"><option value="days">相对窗口</option><option value="custom">固定范围</option></select></label><label className="text-sm">最近天数<input name="days" type="number" min="1" max="365" defaultValue={topic.lookback_period.value ?? 7} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label><label className="text-sm">开始日期<input name="start" type="date" defaultValue={calendarInput(topic.lookback_period.start, topicTimeZone)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label><label className="text-sm">结束日期<input name="end" type="date" defaultValue={calendarInput(topic.lookback_period.end, topicTimeZone)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label></div></fieldset>
      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">生成计划</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">方式<select name="executionMode" defaultValue={topic.execution_mode} className="mt-1 w-full rounded-lg border border-line px-3 py-2"><option value="manual">需要时运行</option><option value="scheduled">自动运行</option></select></label>
          <label className="text-sm">频率<select name="frequency" defaultValue={topic.schedule_config?.frequency ?? "weekly"} className="mt-1 w-full rounded-lg border border-line px-3 py-2"><option value="daily">每天</option><option value="weekly">每周</option></select></label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm">每周运行日</legend>
            <div className="mt-2 flex flex-wrap gap-3">{["日", "一", "二", "三", "四", "五", "六"].map((label, day) => <label key={day} className="flex items-center gap-1.5 text-sm"><input name="weekdays" type="checkbox" value={day} defaultChecked={(topic.schedule_config?.weekdays ?? [1]).includes(day)} />周{label}</label>)}</div>
          </fieldset>
          <label className="text-sm">时间<input name="time" type="time" defaultValue={topic.schedule_config?.time ?? "08:00"} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
          <label className="text-sm">时区<input name="timezone" defaultValue={topic.schedule_config?.timezone ?? "Asia/Shanghai"} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">保存未来设置</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line px-4 py-2 text-sm">取消</button></div>
    </form>
  );
  return (
    <section className="max-w-3xl">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-ink">范围与计划</h2>{!readOnly && <button type="button" onClick={() => setEditing(true)} className="text-sm text-accent hover:underline">编辑</button>}</div>
      {suspicious && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">当前固定范围结束于 {day(topic.lookback_period.end)}，早于主题创建日。系统不会自动修改。</div>}
      <dl className="mt-4 divide-y divide-line rounded-lg border border-line bg-white px-4">
        <ScopeRow label="关注范围" value={[...topic.regions, ...topic.topics, ...topic.entities].join("、") || "按主题描述"} />
        <ScopeRow label="事件类型" value={topic.event_types.join("、") || "重要动态"} />
        <ScopeRow label="包含" value={topic.include_requirements.join("、") || "未额外限制"} />
        <ScopeRow label="排除" value={topic.exclude_requirements.join("、") || "未额外限制"} />
        <ScopeRow label="查询窗口" value={topic.lookback_period.kind === "days" ? `每次回溯最近 ${topic.lookback_period.value ?? 3} 天` : `${day(topic.lookback_period.start)} 至 ${day(topic.lookback_period.end)}`} />
        <ScopeRow label="生成计划" value={topic.execution_mode === "scheduled" ? `${topic.schedule_config?.frequency === "daily" ? "每天" : "每周"} ${topic.schedule_config?.time ?? ""} · ${topic.schedule_config?.timezone ?? ""}` : "需要时运行"} />
        <ScopeRow label="覆盖边界" value="只声明本次实际检索到的来源集合；不代表全网完整覆盖" />
      </dl>
    </section>
  );
}

function ScopeRow({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 py-4 sm:grid-cols-[120px_minmax(0,1fr)]"><dt className="text-sm text-ink-faint">{label}</dt><dd className="text-sm leading-6 text-ink">{value}</dd></div>; }

function RunHistory({ runs, onRetry, canRetry, nextCursor, onLoadMore }: { runs: IntelligenceRun[]; onRetry: (run: IntelligenceRun) => void; canRetry: boolean; nextCursor: string | null; onLoadMore: () => void }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">运行记录</h2>
      {runs.length === 0 ? <p className="mt-4 text-sm text-ink-faint">当前主题还没有运行记录。</p> : <div className="mt-4 space-y-3">{runs.map((run) => (
        <details key={run.id} className="rounded-lg border border-line bg-white px-4 py-3">
          <summary className="cursor-pointer list-none"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm"><span className="font-medium text-ink">{date(run.created_at)}</span><span className="ml-2 text-ink-soft">{statusLabel(run.status)}</span></span><span className="text-xs text-ink-faint">{run.trigger_type} · {day(run.coverage_start)}–{day(run.coverage_end)} · {run.attempt_count} 次尝试</span></div></summary>
          <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs leading-5 text-ink-soft">
            {run.error_message_safe && <p className="text-red-700">{run.error_message_safe}（{run.error_code}）</p>}
            <p>检索状态：{run.retrieval_status || "未形成"}</p>
            {run.checkpoint_stage ? <p>流水线阶段：{pipelineStageLabel(run.checkpoint_stage)} · {run.checkpoint_status || "未知"}</p> : null}
            <p>供应商：{run.provider_diagnostics?.length ? run.provider_diagnostics.map((provider) => `${provider.provider ?? "provider"}${provider.succeeded ? " 成功" : ` ${provider.errorCode ?? "失败"}`}`).join("；") : "无可展示诊断"}</p>
            <DeepSeekAuditLine run={run} />
            <p>诊断仅保存安全结构摘要，不包含凭据、完整 prompt、思维过程或原始整页内容。</p>
            {run.requires_fresh_authorization && ["failed", "blocked"].includes(run.status) ? (
              <p className="text-amber-800">这是旧版单次授权运行，不能直接重放。点击顶部“运行一次”会按当前账户的默认 AI 额度创建新记录。</p>
            ) : null}
            {canRetry && !run.requires_fresh_authorization && ["failed", "blocked"].includes(run.status) && <button type="button" onClick={() => onRetry(run)} className="font-medium text-accent underline">重试同一运行</button>}
          </div>
        </details>
      ))}</div>}
      {nextCursor && <button type="button" onClick={onLoadMore} className="mt-4 text-sm text-accent hover:underline">加载更多</button>}
    </section>
  );
}

function pipelineStageLabel(stage: NonNullable<IntelligenceRun["checkpoint_stage"]>): string {
  return ({ understanding: "理解任务", retrieval: "检索来源", evidence: "核验正文", facts: "提取事实", brief: "形成简报" } as const)[stage];
}

function DeepSeekAuditLine({ run }: { run: IntelligenceRun }) {
  const value = run.usage?.deepseekSearchFetch;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audit = value as Record<string, unknown>;
  const usage = audit.usage && typeof audit.usage === "object" && !Array.isArray(audit.usage) ? audit.usage as Record<string, unknown> : {};
  const attempts = Number(usage.searchAttempts || 0);
  const failed = Number(usage.searchFailed || 0);
  const uncertain = Number(usage.searchUncertain || 0);
  const reserved = Number(usage.reservedUsdMicros || 0);
  const status = audit.enabled === true ? `Search ${attempts} 次（失败 ${failed}，结果不确定 ${uncertain}）` : `未启用${typeof audit.blockReason === "string" ? ` · ${audit.blockReason}` : ""}`;
  return <p>DeepSeek 外部费用审计：{status} · 保守预留 USD {(reserved / 1_000_000).toFixed(6)} · Fetch 关闭</p>;
}
