"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PostReport {
  id: string;
  title: string;
  status: string;
  template_key: string;
  review_status: "draft" | "in_review" | "approved" | "archived";
  period_start: string | null;
  period_end: string | null;
  updated_at: string;
  export_count: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
  internal_review: "内部投后复盘",
  lp_update: "LP 投后更新",
  assoc_update: "协会报送底稿",
};

const REVIEW_LABELS: Record<PostReport["review_status"], string> = {
  draft: "草稿",
  in_review: "评审中",
  approved: "已通过",
  archived: "已归档",
};

export function PostInvestmentReports({ projectId }: { projectId: string }) {
  const [reports, setReports] = useState<PostReport[]>([]);
  const [templateKey, setTemplateKey] = useState("internal_review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/post-reports`);
    if (res.ok) setReports((await res.json()).reports ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/post-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_key: templateKey }),
      });
      if (!res.ok) throw new Error("报告生成失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "报告生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateReview(report: PostReport, review_status: PostReport["review_status"]) {
    const res = await fetch(`/api/projects/${projectId}/post-reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_status }),
    });
    if (!res.ok) return;
    setReports((current) => current.map((item) => item.id === report.id ? { ...item, review_status } : item));
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">投后报告输出</h2>
          <p className="mt-1 text-xs leading-5 text-ink-faint">
            从当前投后材料和管理记录生成底稿，完成评审后再用于内部或对外输出。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className="rounded-md border border-line bg-white px-2.5 py-2 text-xs text-ink-soft outline-none">
            {Object.entries(TEMPLATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button onClick={generate} disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50">
            {busy ? "生成中" : "生成投后报告"}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {reports.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-4 text-xs text-ink-faint">尚未生成投后报告底稿。</p>
      ) : (
        <div className="mt-4 space-y-2">
          {reports.map((report) => (
            <div key={report.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{report.title}</p>
                <p className="mt-1 text-xs text-ink-faint">{TEMPLATE_LABELS[report.template_key] ?? "投后报告"} · 更新于 {new Date(report.updated_at).toLocaleDateString("zh-CN")} · 已导出 {report.export_count} 次</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={report.review_status} onChange={(e) => updateReview(report, e.target.value as PostReport["review_status"])} className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink-soft outline-none" aria-label="报告评审状态">
                  {Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <Link href={`/projects/${projectId}/report?reportId=${report.id}`} className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface">查看</Link>
                <a href={`/api/reports/${report.id}/export`} className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface">导出 Word</a>
                <a href={`/api/reports/${report.id}/export?formal=1&profile=post_investment`} className="rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-xs text-accent hover:bg-[#f3e5dc]">正式版 Word</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
