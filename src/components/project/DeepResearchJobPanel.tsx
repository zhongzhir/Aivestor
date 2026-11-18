"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readError } from "@/lib/clientAI";
import { AnalysisMethodCard, analysisActionClass } from "./AnalysisMethodCard";

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

const PHASE_LABEL: Record<string, string> = {
  queued: "等待开始研究",
  external_research: "搜索并阅读外部权威来源",
  report_generation: "综合项目材料与外部证据",
  quality_gate: "检查报告内容与来源",
  task_creation: "整理待核实事项",
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const jobsResponse = await fetch(`/api/projects/${projectId}/deep-research/jobs`, { cache: "no-store" });
    if (jobsResponse.ok) {
      const next = (await jobsResponse.json()).jobs ?? [];
      setJobs(next);
      if (next[0]?.status === "completed") window.dispatchEvent(new CustomEvent("project-research-job-updated", { detail: { projectId } }));
    }
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

  const active = latest && ["queued", "running"].includes(latest.status);
  return (
    <AnalysisMethodCard icon="full" title="深度投研（完整）"
      description="结合项目材料与外部公开信息，形成深度报告和尽调任务；关闭页面后研究仍会继续。"
      action={<button type="button" onClick={start} disabled={!hasParsedDoc || busy || Boolean(active)} className={analysisActionClass}>
        {active ? "研究进行中" : busy ? "正在提交…" : "启动完整深度投研"}
      </button>}>
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
      {latest && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-slate-700">
            <span>{PHASE_LABEL[latest.phase] || latest.phase}</span>
            <span>{latest.progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${latest.progress}%` }} />
          </div>
          {latest.status === "completed" && latest.report_id && (
            <Link href={`/projects/${projectId}/report?reportId=${latest.report_id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline">
              打开完整深度投研报告
            </Link>
          )}
          {latest.status === "failed" && (
            <div className="mt-3 flex flex-col gap-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span>{latest.error_message || "后台任务失败，已保留过程状态"}</span>
              <button onClick={() => retry(latest.id)} disabled={busy || latest.attempt_count >= latest.max_attempts} className="min-h-11 rounded border border-red-300 px-3 py-2 font-medium disabled:opacity-50">
                重试（{latest.attempt_count}/{latest.max_attempts}）
              </button>
            </div>
          )}
        </div>
      )}
    </AnalysisMethodCard>
  );
}
