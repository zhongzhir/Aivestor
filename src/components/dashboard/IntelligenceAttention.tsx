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

export interface DashboardIntelligenceItem {
  id?: string;
  title?: string;
  content?: string;
  summary?: string;
  importance?: "high" | "medium" | "low";
  sourceTier?: "S" | "A" | "B" | "C" | "D";
  isClue?: boolean;
  investmentNote?: string;
  publishedAt?: string;
  source?: string;
  sourceUrl?: string | null;
}

export interface DashboardIntelligenceBrief {
  id: string;
  taskId: string;
  taskName: string;
  generatedAt: string;
  overview?: string;
  items: DashboardIntelligenceItem[];
}

function scheduleLabel(task: DashboardIntelligenceTask): string {
  if (task.executionMode !== "scheduled" || !task.scheduleConfig) return "手动生成";
  const schedule = task.scheduleConfig;
  const day = schedule.frequency === "weekly"
    ? `每周${(schedule.weekdays ?? [1]).map((value) => ["日", "一", "二", "三", "四", "五", "六"][value] ?? "").join("、")}`
    : "每天";
  return `${day} ${schedule.time ?? "09:00"}${schedule.timezone ? `（${schedule.timezone}）` : ""}`;
}

const TIER_LABEL: Record<string, string> = {
  S: "官方",
  A: "专业",
  B: "媒体",
  C: "门户",
  D: "内部",
};

export function IntelligenceAttention({
  tasks,
  briefs,
  quotaUnavailable,
}: {
  tasks: DashboardIntelligenceTask[];
  briefs: DashboardIntelligenceBrief[];
  quotaUnavailable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const activeTasks = tasks.filter((task) => task.isActive);
  const targetTask = activeTasks[0];
  const sortedBriefs = [...briefs].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
  const brief = sortedBriefs.find((candidate) => candidate.taskId === selectedTaskId) ?? sortedBriefs[0] ?? null;
  const generateTask = tasks.find((task) => task.id === brief?.taskId && task.isActive) ?? targetTask;

  async function generate() {
    if (!generateTask || busy) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/${generateTask.id}/generate`, { method: "POST" });
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

  if (!brief) {
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

  const highlights = brief.items.filter((item) => item.importance === "high" && !item.isClue).slice(0, 3);
  const secondary = brief.items.filter((item) => item.importance !== "high" && !item.isClue).slice(0, 3);
  const clues = brief.items.filter((item) => item.isClue).slice(0, 2);

  return (
    <div className="mt-4 rounded-lg border border-[#e2d8c8] bg-white/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{brief.taskName}</p>
        <p className="text-xs text-ink-faint">生成于 {new Date(brief.generatedAt).toLocaleString("zh-CN")}</p>
      </div>

      {sortedBriefs.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {sortedBriefs.slice(0, 4).map((candidate) => (
            <button
              key={candidate.taskId}
              type="button"
              onClick={() => setSelectedTaskId(candidate.taskId === brief.taskId ? null : candidate.taskId)}
              className={`rounded-full px-2 py-1 text-xs ${candidate.taskId === brief.taskId ? "bg-accent text-white" : "bg-white text-ink-soft hover:border-[#cdbfaa]"}`}
            >
              {candidate.taskName}
            </button>
          ))}
        </div>
      )}

      {brief.overview ? (
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-ink-soft">{brief.overview}</p>
      ) : null}

      {highlights.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-ink">重点动态</p>
          {highlights.map((item, index) => (
            <p key={`${item.id ?? item.title ?? "item"}-${index}`} className="text-xs leading-5 text-ink-soft">
              <span className="font-medium text-ink">{item.title ?? "相关信息"}</span>
              {item.summary || item.content ? `：${item.summary || item.content}` : ""}
              {item.sourceTier ? <span className="ml-1 rounded bg-[#f1f5fb] px-1 py-0.5 text-[10px] text-ink-faint">{TIER_LABEL[item.sourceTier] ?? item.sourceTier}</span> : null}
            </p>
          ))}
        </div>
      )}

      {secondary.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-ink">值得关注</p>
          {secondary.map((item, index) => (
            <p key={`${item.id ?? item.title ?? "item"}-${index}`} className="text-xs leading-5 text-ink-soft">
              <span className="font-medium text-ink">{item.title ?? "相关信息"}</span>
              {item.summary || item.content ? `：${item.summary || item.content}` : ""}
            </p>
          ))}
        </div>
      )}

      {clues.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-ink-soft">待进一步确认</p>
          {clues.map((item, index) => (
            <p key={`${item.id ?? item.title ?? "item"}-${index}`} className="text-xs leading-5 text-ink-faint">
              {item.title ?? "相关信息"}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">查看全部</Link>
        {quotaUnavailable ? <Link href="/settings/ai" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">配置 AI</Link> : generateTask ? <button type="button" onClick={generate} disabled={busy} className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "生成中…" : "生成本期"}</button> : <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">恢复任务</Link>}
        <Link href="/data-apps/intelligence-subscriptions" className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft">管理订制</Link>
      </div>
      {message && <p className="mt-2 text-xs text-red-700">{message}</p>}
    </div>
  );
}
