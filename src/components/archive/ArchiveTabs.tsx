"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { FileUploader } from "@/components/shared/FileUploader";
import { PostInvestment } from "@/components/project/PostInvestment";
import { STAGE_LABELS } from "@/lib/stages";
import { outcomeDef } from "@/lib/outcome";
import { readTextStream, readError } from "@/lib/clientAI";

export interface ArchiveDoc {
  id: string;
  filename: string;
  file_type: string;
  doc_kind: string;
  parse_status: string;
  created_at: string;
}

export interface ArchiveReport {
  id: string;
  title: string;
  version: number;
  status: string;
  updated_at: string;
}

export interface ArchiveJudgment {
  id: string;
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

export interface ArchiveOutcome {
  outcome: string | null;
  outcome_note: string | null;
}

interface Props {
  projectId: string;
  projectName: string;
  initialDocs: ArchiveDoc[];
  reports: ArchiveReport[];
  judgments: ArchiveJudgment[];
  outcome: ArchiveOutcome | null;
}

type Tab = "files" | "reports" | "judgments" | "post";

const TABS: { key: Tab; label: string }[] = [
  { key: "files", label: "项目文件" },
  { key: "reports", label: "分析报告" },
  { key: "judgments", label: "判断记录" },
  { key: "post", label: "投后跟踪" },
];

const DOC_KIND_LABEL: Record<string, string> = {
  bp: "BP",
  research: "尽调报告",
  contract: "合同",
  financial_model: "财务模型",
  news: "新闻",
  other: "其他",
};

const FILE_ICON: Record<string, string> = {
  pdf: "📕",
  docx: "📘",
  pptx: "📙",
  xlsx: "📗",
  image: "🖼️",
};

const REPORT_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  finalized: "已定稿",
};

export function ArchiveTabs({
  projectId,
  projectName,
  initialDocs,
  reports,
  judgments,
  outcome,
}: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [docs, setDocs] = useState<ArchiveDoc[]>(initialDocs);

  async function refreshDocs() {
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`);
      if (!res.ok) return;
      const data = await res.json();
      setDocs(data.documents ?? data ?? []);
    } catch {
      // 刷新失败不影响主流程
    }
  }

  return (
    <div className="mt-6">
      {/* Tab 头 */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-150 ${
                active
                  ? "border-[#1B6FE8] font-medium text-blue-700"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "files" && (
          <FilesTab
            projectId={projectId}
            docs={docs}
            onRefresh={refreshDocs}
          />
        )}
        {tab === "reports" && (
          <ReportsTab
            projectId={projectId}
            projectName={projectName}
            reports={reports}
          />
        )}
        {tab === "judgments" && (
          <JudgmentsTab
            projectId={projectId}
            judgments={judgments}
            outcome={outcome}
          />
        )}
        {tab === "post" && <PostInvestment projectId={projectId} />}
      </div>
    </div>
  );
}

function FilesTab({
  projectId,
  docs,
  onRefresh,
}: {
  projectId: string;
  docs: ArchiveDoc[];
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-ink">上传新文件</p>
        <p className="mt-1 text-xs text-ink-faint">
          支持 PDF / Word / PPT / Excel，单文件最大 4MB
        </p>
        <div className="mt-3">
          <FileUploader
            target="project"
            projectId={projectId}
            onUploadComplete={() => onRefresh()}
          />
        </div>
      </div>

      <p className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-faint">
        已上传文件
      </p>
      {docs.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">还没有文件</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xl">{FILE_ICON[d.file_type] ?? "📄"}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{d.filename}</p>
                  <p className="text-xs text-slate-400">
                    {DOC_KIND_LABEL[d.doc_kind] ?? "其他"}
                    {" · "}
                    {new Date(d.created_at).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                  d.parse_status === "done"
                    ? "bg-green-50 text-green-700"
                    : d.parse_status === "failed"
                      ? "bg-red-50 text-red-700"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {d.parse_status === "done"
                  ? "已解析"
                  : d.parse_status === "failed"
                    ? "解析失败"
                    : "解析中"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 解析报告标题前缀，返回角标类型与去前缀后的展示标题
function reportBadge(title: string): {
  kind: "skill" | "merge" | null;
  display: string;
} {
  if (title.startsWith("【SKILL】")) {
    return { kind: "skill", display: title.replace(/^【SKILL】/, "") };
  }
  if (title.startsWith("【总报告】")) {
    return { kind: "merge", display: title.replace(/^【总报告】/, "") };
  }
  return { kind: null, display: title };
}

function ReportsTab({
  projectId,
  projectName,
  reports,
}: {
  projectId: string;
  projectName: string;
  reports: ArchiveReport[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMerge, setShowMerge] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
        <p className="text-sm text-ink-soft">还没有分析报告</p>
        <Link
          href={`/projects/${projectId}/report`}
          className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline"
        >
          去生成报告 →
        </Link>
      </div>
    );
  }

  const selectedReports = reports.filter((r) => selected.has(r.id));

  return (
    <div className="relative">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {reports.map((r) => {
          const badge = reportBadge(r.title);
          const checked = selected.has(r.id);
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(r.id)}
                className="h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
                aria-label={`选择报告：${badge.display}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {badge.kind === "skill" && (
                    <span className="shrink-0 rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-inset ring-purple-200">
                      SKILL 分析
                    </span>
                  )}
                  {badge.kind === "merge" && (
                    <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-200">
                      总报告
                    </span>
                  )}
                  <p className="truncate text-sm font-medium text-ink">
                    {badge.display}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  v{r.version}
                  {" · "}
                  {REPORT_STATUS_LABEL[r.status] ?? r.status}
                  {" · "}
                  {new Date(r.updated_at).toLocaleDateString("zh-CN")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <Link
                  href={`/projects/${projectId}/report?reportId=${r.id}`}
                  className="rounded border border-slate-200 px-2 py-1 text-ink-soft hover:bg-slate-50"
                >
                  查看
                </Link>
                <a
                  href={`/api/reports/${r.id}/export`}
                  className="rounded border border-slate-200 px-2 py-1 text-ink-soft hover:bg-slate-50"
                >
                  Word
                </a>
                <a
                  href={`/api/reports/${r.id}/export-ppt`}
                  className="rounded border border-slate-200 px-2 py-1 text-ink-soft hover:bg-slate-50"
                >
                  PPT
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 悬浮合并栏：勾选 ≥2 条时出现 */}
      {selected.size >= 2 && !showMerge && (
        <div className="sticky bottom-4 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
          <p className="text-sm text-ink-soft">
            已选 <span className="font-semibold text-ink">{selected.size}</span>{" "}
            份分析
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50"
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => setShowMerge(true)}
              className="rounded-lg bg-[#1B6FE8] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1762d0]"
            >
              合并生成总报告 →
            </button>
          </div>
        </div>
      )}

      {showMerge && (
        <MergePanel
          projectId={projectId}
          projectName={projectName}
          reports={selectedReports}
          onRemove={toggle}
          onClose={() => {
            setShowMerge(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function MergePanel({
  projectId,
  projectName,
  reports,
  onRemove,
  onClose,
}: {
  projectId: string;
  projectName: string;
  reports: ArchiveReport[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(`${projectName} · 投委会分析报告`);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const hasResult = result.length > 0;
  const locked = merging || hasResult;

  async function start() {
    if (reports.length < 2) {
      setError("至少需要 2 份报告");
      return;
    }
    setMerging(true);
    setError("");
    setResult("");
    setDone(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/reports/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportIds: reports.map((r) => r.id),
          title,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "生成失败"));
      }
      await readTextStream(res, (t) => setResult((c) => c + t));
      setDone(true);
      router.refresh(); // 刷新档案页报告列表，新总报告出现在顶部
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-canvas shadow-xl">
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              合并生成投委会总报告
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              将多份分析整合为固定章节的总报告
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕ 关闭
          </button>
        </div>

        <div className="flex-1 px-6 py-5">
          {/* 已选报告列表 */}
          <p className="text-xs font-medium text-ink-soft">
            已选报告（{reports.length}）
          </p>
          <ul className="mt-2 space-y-1.5">
            {reports.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm"
              >
                <span className="truncate text-ink">
                  {reportBadge(r.title).display}
                </span>
                {!locked && (
                  <button
                    onClick={() => onRemove(r.id)}
                    className="shrink-0 text-xs text-ink-faint hover:text-red-600"
                    aria-label="移除"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {reports.length < 2 && (
            <p className="mt-2 text-xs text-red-600">
              至少需要 2 份报告，请返回列表再勾选。
            </p>
          )}

          {/* 报告标题 */}
          <label className="mt-4 block text-xs font-medium text-ink-soft">
            报告标题
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={locked}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-surface"
          />

          {!hasResult && (
            <button
              onClick={start}
              disabled={merging || reports.length < 2}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {merging ? "生成中…" : "开始生成"}
            </button>
          )}

          {error && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {(merging || hasResult) && (
            <div className="mt-5 border-t border-line pt-5">
              <article className="report-body min-h-[120px]">
                {hasResult ? (
                  <>
                    <ReactMarkdown>{result}</ReactMarkdown>
                    {merging && <span className="type-cursor" />}
                  </>
                ) : (
                  <p className="text-sm text-ink-faint">AI 正在整合多份报告…</p>
                )}
              </article>
              {done && (
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-sm text-green-700">
                    ✅ 总报告已生成并存入项目档案
                  </span>
                  <button
                    onClick={onClose}
                    className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
                  >
                    完成
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JudgmentsTab({
  projectId,
  judgments,
  outcome,
}: {
  projectId: string;
  judgments: ArchiveJudgment[];
  outcome: ArchiveOutcome | null;
}) {
  return (
    <div>
      <PendingQuestions projectId={projectId} />
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          判断时间线
        </p>
        <Link
          href={`/projects/${projectId}`}
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          + 新增判断（去项目页）
        </Link>
      </div>

      {judgments.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">
          还没有判断记录。在项目页记录每个阶段的判断，长期会积累成你的认知资产。
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {judgments.map((j) => {
            const conf = j.confidence_level ?? 0;
            return (
              <div
                key={j.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-medium text-blue-700">
                    {STAGE_LABELS[j.stage] ?? j.stage}
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span className="text-ink-soft">
                    {conf > 0
                      ? "★".repeat(conf) + "☆".repeat(5 - conf)
                      : "未评分"}
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span className="text-slate-400">
                    {new Date(j.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-ink-soft">
                  {j.bull_case && (
                    <p>
                      <span className="font-medium">看好：</span>
                      {j.bull_case}
                    </p>
                  )}
                  {j.bear_case && (
                    <p>
                      <span className="font-medium">顾虑：</span>
                      {j.bear_case}
                    </p>
                  )}
                  {j.founder_assessment && (
                    <p>
                      <span className="font-medium">创始人：</span>
                      {j.founder_assessment}
                    </p>
                  )}
                  {j.key_hypothesis && (
                    <p>
                      <span className="font-medium">核心假设：</span>
                      {j.key_hypothesis}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {outcome?.outcome && outcome.outcome !== "pending" && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            最终结果
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                outcomeDef(outcome.outcome).badgeClass
              }`}
            >
              {outcomeDef(outcome.outcome).icon}{" "}
              {outcomeDef(outcome.outcome).label}
            </span>
          </div>
          {outcome.outcome_note && (
            <p className="mt-2 text-xs text-ink-soft">{outcome.outcome_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

// 项目页「遗留疑问」折叠区块：聚合本项目所有对话沉淀的 open_questions
function PendingQuestions({ projectId }: { projectId: string }) {
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/pending-questions`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setQuestions(data.questions ?? []);
      } catch {
        if (!cancelled) setQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!questions || questions.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border-l-4 border-blue-500 bg-[#1B6FE808]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-blue-700">
          💬 遗留疑问（{questions.length} 条）
        </span>
        <span className="text-xs text-blue-700/70">
          {open ? "收起 ∧" : "展开 ∨"}
        </span>
      </button>
      {open && (
        <div className="border-t border-blue-100 px-3 py-2.5">
          <ul className="space-y-1 text-xs text-ink-soft">
            {questions.map((q, i) => (
              <li key={i}>· {q}</li>
            ))}
          </ul>
          <p className="mt-2 text-right text-xs text-blue-700/70">
            来自对话沉淀
          </p>
        </div>
      )}
    </div>
  );
}
