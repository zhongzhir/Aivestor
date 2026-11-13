"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntelligenceTopicCreator } from "./IntelligenceTopicCreator";
import { IntelligenceTopicView } from "./IntelligenceTopicView";
import type { IntelligenceTopic, SchedulerStatus } from "./intelligenceTypes";

interface WorkspaceData {
  tasks: IntelligenceTopic[];
  archivedTasks: Array<Pick<IntelligenceTopic, "id" | "name" | "topics" | "entities" | "archived_at">>;
  scheduler: SchedulerStatus;
  quotaAvailable: boolean;
  aiSource: "custom" | "platform" | null;
  aiProvider: string | null;
}

function metadataOverview(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const overview = (value as Record<string, unknown>).overview;
  return typeof overview === "string" ? overview.replace(/^#{1,3}\s+/, "").trim() : "";
}

function scopeNeedsReview(task: IntelligenceTopic): boolean {
  if (task.lookback_period.kind !== "custom" || !task.lookback_period.end) return false;
  const end = new Date(task.lookback_period.end).getTime();
  const created = new Date(task.created_at).getTime();
  return Number.isFinite(end) && Number.isFinite(created) && created - end > 24 * 60 * 60 * 1000;
}

function needsAttention(task: IntelligenceTopic, scheduler: SchedulerStatus): boolean {
  return ["failed", "blocked", "partial"].includes(task.last_run_status ?? "")
    || scopeNeedsReview(task)
    || (task.is_active && task.execution_mode === "scheduled" && !scheduler.healthy);
}

export function IntelligenceWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicId = searchParams.get("topic");
  const initialDescription = (searchParams.get("brief") ?? "").slice(0, 2_000);
  const creating = searchParams.get("new") === "1" || Boolean(initialDescription);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/data-apps/intelligence-subscriptions", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "加载情报工作空间失败");
      setData(body as WorkspaceData);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载情报工作空间失败");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openTopic = (id: string) => router.push(`/data-apps/intelligence-subscriptions?topic=${encodeURIComponent(id)}`);
  const openWorkspace = () => router.push("/data-apps/intelligence-subscriptions");
  const openCreate = () => router.push("/data-apps/intelligence-subscriptions?new=1");
  const restore = async (id: string) => {
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/${id}`, { method: "PUT" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || "恢复归档主题失败");
      return;
    }
    await load();
  };

  if (creating) return (
    <IntelligenceTopicCreator
      initialDescription={initialDescription}
      onCancel={openWorkspace}
      onCreated={openTopic}
    />
  );
  if (topicId) return <IntelligenceTopicView
    topicId={topicId}
    scheduler={data?.scheduler ?? { healthy: false, lastHeartbeatAt: null }}
    quotaAvailable={data?.quotaAvailable ?? false}
    aiSource={data?.aiSource ?? null}
    aiProvider={data?.aiProvider ?? null}
    onBack={openWorkspace}
    onChanged={load}
  />;

  const tasks = data?.tasks ?? [];
  const visible = tasks.filter((task) => {
    if (filter === "attention" && !needsAttention(task, data?.scheduler ?? { healthy: false, lastHeartbeatAt: null })) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [task.name, ...task.topics, ...task.entities].join(" ").toLowerCase().includes(needle);
  });
  const attentionCount = tasks.filter((task) => needsAttention(task, data?.scheduler ?? { healthy: false, lastHeartbeatAt: null })).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">情报工作空间</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">持续关注投资事件，查看真实运行状态与历史简报。</p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white">新建主题</button>
      </div>

      {error && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error} <button type="button" onClick={load} className="ml-2 underline">重试</button></div>}

      {!data && !error ? <div className="mt-6 rounded-lg border border-line bg-white px-4 py-8 text-sm text-ink-faint">正在加载工作空间…</div> : null}

      {data && tasks.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-ink">还没有投资情报主题</h2>
          <p className="mt-2 text-sm text-ink-soft">用一句话说明要持续关注或一次性回溯的投资事件。</p>
          <button type="button" onClick={openCreate} className="mt-5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white">创建第一个主题</button>
          <p className="mt-3 text-xs text-ink-faint">例如：每周跟踪中国机器人企业融资与并购</p>
        </div>
      ) : null}

      {data && tasks.length > 0 ? (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex gap-1 rounded-lg bg-surface p-1">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>全部 {tasks.length}</FilterButton>
              <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")}>需处理 {attentionCount}</FilterButton>
            </div>
            <label>
              <span className="sr-only">搜索主题</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索主题…" className="w-56 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent" />
            </label>
          </div>
          <div className="divide-y divide-line rounded-xl border border-line bg-white">
            {visible.length === 0 ? <p className="px-5 py-10 text-center text-sm text-ink-faint">没有符合条件的主题。</p> : visible.map((task) => (
              <TopicRow key={task.id} task={task} scheduler={data.scheduler} onOpen={() => openTopic(task.id)} />
            ))}
          </div>
        </>
      ) : null}

      {data && data.archivedTasks.length > 0 ? (
        <details className="mt-8 rounded-xl border border-line bg-white px-5 py-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">已归档主题（{data.archivedTasks.length}）</summary>
          <div className="mt-4 divide-y divide-line border-t border-line">
            {data.archivedTasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p className="text-sm font-medium text-ink">{task.name}</p><p className="mt-1 text-xs text-ink-faint">历史简报仍保留；恢复后默认保持暂停。</p></div>
                <div className="flex gap-3"><button type="button" onClick={() => openTopic(task.id)} className="text-sm text-ink-soft hover:text-ink">查看历史</button><button type="button" onClick={() => restore(task.id)} className="text-sm font-medium text-accent">恢复</button></div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-md px-3 py-1.5 text-xs ${active ? "bg-white font-medium text-ink shadow-sm" : "text-ink-soft"}`}>{children}</button>;
}

function TopicRow({ task, scheduler, onOpen }: { task: IntelligenceTopic; scheduler: SchedulerStatus; onOpen: () => void }) {
  const overview = metadataOverview(task.latest_brief_metadata);
  const suspicious = scopeNeedsReview(task);
  const scheduleUnknown = task.is_active && task.execution_mode === "scheduled" && !scheduler.healthy;
  const status = task.last_run_status;
  return (
    <article className="px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-ink">{task.name}</h2>
            <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-ink-soft">{task.execution_mode === "scheduled" ? "自动监测" : "一次性研究"}</span>
            {!task.is_active && <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">已暂停</span>}
          </div>
          <p className="mt-1 text-xs leading-5 text-ink-faint">
            {task.last_generated_at ? `最近成果 ${new Date(task.last_generated_at).toLocaleString("zh-CN")}` : status ? `最近运行：${runLabel(status)}` : "尚未执行"}
            {task.execution_mode === "scheduled" ? scheduleUnknown ? " · 自动运行状态不可确认" : task.next_run_at ? ` · 下次 ${new Date(task.next_run_at).toLocaleString("zh-CN")}` : " · 尚无下次计划" : ""}
          </p>
          {suspicious ? <p className="mt-2 text-xs text-amber-700">范围可能异常：结束日期早于主题创建日，系统不会自动修改。</p> : null}
          {status === "failed" || status === "blocked" ? <p className="mt-2 text-xs text-red-700">{task.last_run_error || "最近一次运行未完成，旧成果仍保留。"}</p> : null}
          {status === "partial" ? <p className="mt-2 text-xs text-amber-700">最近一次仅部分来源可用，结论不代表完整市场覆盖。</p> : null}
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-soft">{overview || (task.latest_brief_id ? `${task.latest_item_count ?? 0} 条事件，打开主题查看来源和历史。` : "打开主题运行首次研究并查看范围。")}</p>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-soft hover:border-accent hover:text-ink">查看主题 →</button>
      </div>
    </article>
  );
}

function runLabel(status: string) {
  return ({ queued: "等待运行", running: "运行中", succeeded: "完成", partial: "部分完成", no_new_items: "无新事件", failed: "失败", blocked: "受阻", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}
