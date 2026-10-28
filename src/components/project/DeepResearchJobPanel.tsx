"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readError } from "@/lib/clientAI";

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Job {
  id: string;
  report_id: string | null;
  status: JobStatus;
  phase: string;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  error_message?: string | null;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  details: string | null;
  priority: "P0" | "P1" | "P2";
  status: "open" | "in_progress" | "done" | "dismissed";
}

const PHASE_LABEL: Record<string, string> = {
  queued: "等待后台研究进程",
  external_research: "搜索并阅读外部权威来源",
  report_generation: "综合项目材料与外部证据",
  quality_gate: "执行结构与证据门禁",
  task_creation: "把缺口转为尽调任务",
  completed: "完整深度投研已完成",
  failed: "任务执行失败",
};

export function DeepResearchJobPanel({
  projectId,
  hasParsedDoc,
  profile,
  decisionContext,
}: {
  projectId: string;
  hasParsedDoc: boolean;
  profile: "auto" | "early_stage" | "comprehensive";
  decisionContext: string;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [jobsResponse, tasksResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/deep-research/jobs`, { cache: "no-store" }),
      fetch(`/api/projects/${projectId}/deep-research/tasks`, { cache: "no-store" }),
    ]);
    if (jobsResponse.ok) setJobs((await jobsResponse.json()).jobs ?? []);
    if (tasksResponse.ok) setTasks((await tasksResponse.json()).tasks ?? []);
  }, [projectId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const latest = jobs[0];
  useEffect(() => {
    if (!latest || !["queued", "running"].includes(latest.status)) return;
    const timer = window.setTimeout(() => load().catch(() => undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [latest, load]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/deep-research/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          decisionContext,
          sourceCutoffDate: new Date().toLocaleDateString("sv-SE"),
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "启动失败"));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "启动失败");
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/deep-research/jobs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action: "retry" }),
      });
      if (!response.ok) throw new Error(await readError(response, "重试失败"));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重试失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateTask(task: Task, status: Task["status"]) {
    const response = await fetch(`/api/projects/${projectId}/deep-research/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, status }),
    });
    if (response.ok) await load();
  }

  const active = latest && ["queued", "running"].includes(latest.status);
  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-900">完整模式：后台外部取证＋深度报告</p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            服务端持续执行，关闭页面后不会中断；完成后自动形成报告、质量门禁和尽调任务。
          </p>
        </div>
        <button
          onClick={start}
          disabled={!hasParsedDoc || busy || Boolean(active)}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {active ? "研究进行中" : busy ? "正在提交…" : "启动完整深度投研"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      {latest && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-emerald-900">
            <span>{PHASE_LABEL[latest.phase] || latest.phase}</span>
            <span>{latest.progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${latest.progress}%` }} />
          </div>
          {latest.status === "completed" && latest.report_id && (
            <Link href={`/projects/${projectId}/report?reportId=${latest.report_id}`} className="mt-3 inline-block text-xs font-medium text-emerald-800 underline">
              打开完整深度投研报告
            </Link>
          )}
          {latest.status === "failed" && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-red-700">
              <span>{latest.error_message || "后台任务失败，已保留过程状态"}</span>
              <button onClick={() => retry(latest.id)} disabled={busy || latest.attempt_count >= latest.max_attempts} className="rounded border border-red-300 px-2 py-1 disabled:opacity-50">
                重试（{latest.attempt_count}/{latest.max_attempts}）
              </button>
            </div>
          )}
        </div>
      )}
      {tasks.length > 0 && (
        <details className="mt-4 text-xs text-emerald-950">
          <summary className="cursor-pointer font-medium">尽调任务 {tasks.filter((task) => !["done", "dismissed"].includes(task.status)).length} 项待处理</summary>
          <div className="mt-2 space-y-2">
            {tasks.slice(0, 20).map((task) => (
              <div key={task.id} className="flex items-start gap-2 rounded border border-emerald-200 bg-white p-2">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium">{task.priority}</span>
                <div className="min-w-0 flex-1">
                  <p className={task.status === "done" ? "line-through opacity-60" : ""}>{task.title}</p>
                  {task.details && <p className="mt-1 text-emerald-800/70">{task.details}</p>}
                </div>
                <select value={task.status} onChange={(event) => updateTask(task, event.target.value as Task["status"])} className="rounded border border-emerald-200 bg-white px-1 py-1">
                  <option value="open">待处理</option>
                  <option value="in_progress">处理中</option>
                  <option value="done">已完成</option>
                  <option value="dismissed">不处理</option>
                </select>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
