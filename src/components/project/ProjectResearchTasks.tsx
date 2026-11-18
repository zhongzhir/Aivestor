"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
interface Task {
  id: string; title: string; details: string | null; source_href?: string;
  priority: string; status: "open" | "in_progress" | "done" | "dismissed";
}

export function ProjectResearchTasks({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/deep-research/tasks`, { cache: "no-store" });
    if (!res.ok) throw new Error("暂时无法读取尽调待办");
    setTasks((await res.json()).tasks ?? []);
  }, [projectId]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail?.projectId === projectId) void load().catch((e) => setError(e.message));
    };
    window.addEventListener("project-research-saved", refresh);
    window.addEventListener("project-research-job-updated", refresh);
    return () => { window.removeEventListener("project-research-saved", refresh); window.removeEventListener("project-research-job-updated", refresh); };
  }, [load, projectId]);
  async function update(task: Task, status: Task["status"]) {
    setBusy(task.id); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/deep-research/tasks`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, status }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "状态未保存，请重试");
      setTasks((list) => list.map((item) => item.id === task.id ? { ...item, status } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(null); }
  }
  if (!tasks.length && !error) return null;
  const pending = tasks.filter((task) => !["done", "dismissed"].includes(task.status));
  const visible = showCompleted ? tasks : pending;
  return <details className="border-b border-slate-100 px-4 py-3">
    <summary className="cursor-pointer text-sm font-medium text-slate-700">尽调待办 <span className="ml-2 text-xs font-normal text-slate-500">{pending.length} 项待处理</span></summary>
    <div className="mt-3 space-y-2">
      {visible.map((task) => <div key={task.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1"><p className={`break-words text-sm leading-6 ${["done", "dismissed"].includes(task.status) ? "text-slate-400" : "text-slate-700"}`}>{!task.source_href && <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{task.priority}</span>}{task.title}</p>
          {task.source_href ? <Link href={task.source_href} className="mt-1 inline-block text-xs text-accent">查看来源对话</Link>
            : task.details && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-500">{task.details}</p>}</div>
        <select aria-label={`待办状态：${task.title}`} disabled={busy === task.id} value={task.status} onChange={(e) => void update(task, e.target.value as Task["status"])} className="min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 disabled:opacity-50">
          <option value="open">待处理</option><option value="in_progress">处理中</option><option value="done">已完成</option><option value="dismissed">不再跟进</option>
        </select>
      </div>)}
      {!visible.length && <p className="text-xs text-slate-500">当前没有待处理事项。</p>}
      {tasks.length > pending.length && <button type="button" onClick={() => setShowCompleted(!showCompleted)} className="min-h-9 text-xs text-slate-500">{showCompleted ? "收起已结束事项" : `查看已结束事项（${tasks.length - pending.length}）`}</button>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  </details>;
}
