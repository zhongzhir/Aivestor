"use client";

import Link from "next/link";
import { useState } from "react";

export interface DashboardIntelligenceTask {
  id: string;
  name: string;
  isActive: boolean;
  executionMode: "manual" | "scheduled";
  scheduleConfig: { frequency?: string; time?: string; timezone?: string; weekdays?: number[] } | null;
}

export interface DashboardIntelligenceBrief {
  id: string;
  taskName: string;
  generatedAt: string;
  items: Array<{ title?: string; content?: string }>;
}

function scheduleLabel(task: DashboardIntelligenceTask): string {
  if (task.executionMode !== "scheduled" || !task.scheduleConfig) return "手动生成";
  const schedule = task.scheduleConfig;
  const day = schedule.frequency === "weekly"
    ? `每周${(schedule.weekdays ?? [1]).map((value) => ["日", "一", "二", "三", "四", "五", "六"][value] ?? "").join("、")}`
    : "每天";
  return `${day} ${schedule.time ?? "09:00"}${schedule.timezone ? `（${schedule.timezone}）` : ""}`;
}

export function IntelligenceAttention({
  tasks,
  latestBrief,
  quotaUnavailable,
}: {
  tasks: DashboardIntelligenceTask[];
  latestBrief: DashboardIntelligenceBrief | null;
  quotaUnavailable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeTasks = tasks.filter((task) => task.isActive);
  const targetTask = activeTasks[0];

  async function generate() {
    if (!targetTask || busy) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/${targetTask.id}/generate`, { method: "POST" });
    if (!response.ok) {
      setMessage(response.status === 402 ? "额度暂时不足，请配置 AI 或管理订制。" : "暂时无法生成，请稍后重试。 ");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  if (tasks.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-[#e2d8c8] bg-white/70 p-3">
        <p className="text-sm font-medium text-ink">创建你的情报订制</p>
        <p className="mt-1 text-xs leading-5 text-ink-soft">持续关注你关心的行业、公司和事件</p>
        <Link href="/data-apps/intelligence-subscriptions" className="mt-3 inline-flex rounded-md bg-accent px-3 py-2 text-xs font-medium text-white">
          开始订制
        </Link>
      </div>
    );
  }

  if (!latestBrief) {
    return (
      <div className="mt-4 rounded-lg border border-[#e2d8c8] bg-white/70 p-3">
        <p className="text-sm font-medium text-ink">正在关注</p>
        <div className="mt-2 space-y-1 text-xs text-ink-soft">
          {activeTasks.length > 0 ? activeTasks.map((task) => <p key={task.id}>{task.name} · 下次计划：{scheduleLabel(task)}</p>) : <p>订制已停用</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {quotaUnavailable ? <><Link href="/settings/ai" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">配置 AI</Link><Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">恢复任务</Link></> : targetTask ? <button type="button" onClick={generate} disabled={busy} className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "生成中…" : "生成本期简报"}</button> : null}
          <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">管理订制</Link>
        </div>
        {message && <p className="mt-2 text-xs text-red-700">{message}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-[#e2d8c8] bg-white/70 p-3">
      <p className="text-sm font-medium text-ink">{latestBrief.taskName}</p>
      <p className="mt-1 text-xs text-ink-faint">生成于 {new Date(latestBrief.generatedAt).toLocaleString("zh-CN")}</p>
      <div className="mt-3 space-y-2">
        {latestBrief.items.slice(0, 5).map((item, index) => <p key={`${item.title ?? "item"}-${index}`} className="text-xs leading-5 text-ink-soft"><span className="font-medium text-ink">{item.title ?? "相关信息"}</span>{item.content ? `：${item.content}` : ""}</p>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">查看全部</Link>
        {quotaUnavailable ? <Link href="/settings/ai" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">配置 AI</Link> : targetTask ? <button type="button" onClick={generate} disabled={busy} className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "生成中…" : "生成本期"}</button> : <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">恢复任务</Link>}
        <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">管理订制</Link>
      </div>
      {message && <p className="mt-2 text-xs text-red-700">{message}</p>}
    </div>
  );
}
