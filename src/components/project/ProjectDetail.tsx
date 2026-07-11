"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FinancialCharts } from "./FinancialCharts";
import { StageProgress, type Judgment } from "./StageProgress";
import { DecisionTools } from "./DecisionTools";
import { PostInvestment } from "./PostInvestment";
import { CommentPanel } from "./CommentPanel";
import { JudgmentsByMember } from "./JudgmentsByMember";
import { ShareControl } from "./ShareControl";
import { confirmSensitiveAction } from "@/lib/securityPolicy";
import {
  FileUploader,
  type UploadResult,
} from "@/components/shared/FileUploader";
import { SkillRunModal } from "@/components/skills/SkillRunModal";
import { stashJudgmentPoints, readError } from "@/lib/clientAI";
import { outcomeDef } from "@/lib/outcome";
import type { FinancialData } from "@/lib/types";

type Tab = "analysis" | "decision" | "post";

export interface DocMeta {
  id: string;
  filename: string;
  chars: number;
  fileType: string;
  docKind: string;
  parseStatus: string;
  uploadedAt: string;
}

const EST_TOKENS_PER_IMAGE = 600;

function estimateMinutes(imageCount: number): number {
  return Math.max(1, Math.ceil(imageCount / 2));
}

interface ImgState {
  loading: boolean;
  supported: boolean;
  imageCount: number;
  analyzed: boolean;
  analyzing: boolean;
  note: string;
  error: string;
}

const FILE_TYPE_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "DOC",
  pptx: "PPT",
  xlsx: "XLS",
  xls: "XLS",
};

const PROCESS_STAGE_LABEL: Record<string, string> = {
  screening: "初筛",
  due_diligence: "尽调",
  investment_committee: "投委会",
  post_investment: "投后管理",
  passed: "已 Pass",
  exited: "已退出",
};

interface Props {
  projectId: string;
  projectName: string;
  processStage: string;
  outcome: string | null;
  outcomeNote: string | null;
  judgments: Judgment[];
  bpText: string;
  docMeta: DocMeta[];
  initialPoints: string[];
  latestReportId: string | null;
  initialFinancialData: FinancialData | null;
  isOrgProject?: boolean;
  hasOrg?: boolean;
  currentUserId?: string;
}

export function ProjectDetail({
  projectId,
  projectName,
  processStage,
  outcome,
  outcomeNote,
  judgments,
  bpText,
  docMeta,
  initialPoints,
  latestReportId,
  initialFinancialData,
  isOrgProject = false,
  hasOrg = false,
  currentUserId,
}: Props) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("analysis");
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [newUpload, setNewUpload] = useState(false);
  const [hasTeamJudgments, setHasTeamJudgments] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [imgStates, setImgStates] = useState<Record<string, ImgState>>({});
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [points, setPoints] = useState<string[]>(
    initialPoints.length > 0 ? initialPoints : ["", "", ""]
  );
  const [error, setError] = useState("");
  const [financials, setFinancials] = useState<FinancialData | null>(
    initialFinancialData
  );
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState("");

  const hasParsedDoc = docMeta.some((d) => d.parseStatus === "done");

  useEffect(() => {
    const bpDocs = docMeta.filter(
      (d) => d.docKind === "bp" && d.parseStatus === "done"
    );
    if (bpDocs.length === 0) return;

    fetch("/api/user/quota-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => {
        if (q?.enabled) setQuotaRemaining(q.tokensRemaining ?? null);
      })
      .catch(() => {});

    for (const d of bpDocs) {
      setImgStates((prev) =>
        prev[d.id]?.analyzing || prev[d.id]?.note
          ? prev
          : {
              ...prev,
              [d.id]: {
                loading: true,
                supported: false,
                imageCount: 0,
                analyzed: false,
                analyzing: false,
                note: "",
                error: "",
              },
            }
      );
      fetch(`/api/documents/${d.id}/image-status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setImgStates((prev) => {
            if (prev[d.id]?.analyzing || prev[d.id]?.note) return prev;
            return {
              ...prev,
              [d.id]: {
                loading: false,
                supported: !!data.supported,
                imageCount: data.imageCount ?? 0,
                analyzed: !!data.analyzed,
                analyzing: false,
                note: "",
                error: "",
              },
            };
          });
        })
        .catch(() => {
          setImgStates((prev) => ({
            ...prev,
            [d.id]: { ...prev[d.id], loading: false },
          }));
        });
    }
  }, [docMeta]);

  function handleUploadComplete(results: UploadResult[]) {
    if (results.some((r) => r.status === "done")) {
      setNewUpload(true);
      router.refresh();
    }
  }

  async function handleTransferToOrg() {
    if (
      !confirmSensitiveAction(
        "转入后不可撤销：项目及其文档、报告、判断、会议记录将归属组织，组织管理层可见。确定转入？"
      )
    ) {
      return;
    }
    setTransferring(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/transfer-to-org`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert(await readError(res));
      }
    } finally {
      setTransferring(false);
    }
  }

  async function analyzeImages(docId: string) {
    setImgStates((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], analyzing: true, error: "" },
    }));
    try {
      const res = await fetch(`/api/documents/${docId}/image-analysis`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "图片识别失败");
      const parts = [`已识别 ${data.count} 张图片`];
      if (data.failed > 0) parts.push(`${data.failed} 张失败`);
      if (data.skipped > 0) parts.push(`${data.skipped} 张未处理`);
      setImgStates((prev) => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          analyzing: false,
          analyzed: true,
          note: parts.join("，"),
        },
      }));
    } catch (e) {
      setImgStates((prev) => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          analyzing: false,
          error: e instanceof Error ? e.message : "图片识别失败",
        },
      }));
    }
  }

  async function handleExtractFinancials() {
    setError("");
    setFinError("");
    setFinLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await readError(res, "提取失败"));
      }
      const data = await res.json();
      setFinancials(data.financialData);
    } catch (e) {
      setFinError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setFinLoading(false);
    }
  }

  function updatePoint(i: number, v: string) {
    setPoints((prev) => prev.map((p, idx) => (idx === i ? v : p)));
  }

  function addPoint() {
    if (points.length < 10) setPoints((p) => [...p, ""]);
  }

  function removePoint(i: number) {
    if (points.length > 1) setPoints((p) => p.filter((_, idx) => idx !== i));
  }

  function handleGenerate() {
    const filled = points.map((p) => p.trim()).filter(Boolean);
    if (filled.length < 3 || filled.length > 10) {
      setError("请输入 3-10 条判断要点");
      return;
    }
    setError("");
    stashJudgmentPoints(projectId, filled);
    router.push(`/projects/${projectId}/report?generate=1`);
  }

  const parsedDocCount = docMeta.filter((d) => d.parseStatus === "done").length;
  const bpDocCount = docMeta.filter((d) => d.docKind === "bp").length;
  const stageLabel = PROCESS_STAGE_LABEL[processStage] ?? "待整理";
  const reportState = latestReportId ? "已有分析报告" : "等待生成报告";
  const nextAction = latestReportId
    ? "可以继续打磨报告，或进入决策辅助"
    : hasParsedDoc
      ? "材料已就绪，可以补充判断并生成报告"
      : "先补充 BP、财务模型或项目材料";
  const evidenceNote =
    docMeta.length === 0
      ? "尚未看到项目材料"
      : `${parsedDocCount}/${docMeta.length} 份材料已解析`;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <div className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-ink">
                {projectName}
              </h1>
              <span className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft">
                {stageLabel}
              </span>
              {outcome && outcome !== "pending" && (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    outcomeDef(outcome).badgeClass
                  }`}
                >
                  {outcomeDef(outcome).icon} {outcomeDef(outcome).label}
                </span>
              )}
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-soft">
              项目工作区把材料、判断、报告和团队协作放在同一条线上。先看当前阶段和证据状态，再决定下一步。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {latestReportId && (
              <Link
                href={`/projects/${projectId}/report`}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
              >
                查看报告
              </Link>
            )}
            <button
              onClick={handleGenerate}
              className="rounded-lg bg-[#2f6f4f] px-3 py-2 text-sm font-medium text-white hover:bg-[#265b42]"
            >
              生成分析报告
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <WorkspaceMetric label="阶段" value={stageLabel} note="可在下方流程中调整" />
          <WorkspaceMetric label="材料" value={`${parsedDocCount}/${docMeta.length}`} note={evidenceNote} />
          <WorkspaceMetric label="报告" value={latestReportId ? "已生成" : "待生成"} note={reportState} />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <StageProgress
          projectId={projectId}
          initialStage={processStage}
          initialJudgments={judgments}
          initialOutcome={outcome}
          initialOutcomeNote={outcomeNote}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex gap-1 border-b border-line">
            {([
              ["analysis", "项目分析"],
              ["decision", "决策辅助"],
              ...(outcome === "invested" || processStage === "post_investment"
                ? ([["post", "投后管理"]] as [Tab, string][])
                : []),
            ] as [Tab, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                  tab === id
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "decision" && (
            <div className="mt-6">
              <DecisionTools projectId={projectId} processStage={processStage} />
            </div>
          )}

          {tab === "post" && <PostInvestment projectId={projectId} />}

          {tab === "analysis" && (
            <>
              {!isOrgProject && hasOrg && (
                <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
                  <p className="text-xs text-ink-soft">
                    将本项目转为组织项目后，团队成员可协作查看、评论和沉淀判断。
                  </p>
                  <button
                    onClick={handleTransferToOrg}
                    disabled={transferring}
                    className="shrink-0 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {transferring ? "转入中…" : "转为组织项目"}
                  </button>
                </div>
              )}

              {isOrgProject && (
                <div
                  className={`mt-6 grid gap-6 ${
                    hasTeamJudgments ? "lg:grid-cols-3" : ""
                  }`}
                >
                  <div className={hasTeamJudgments ? "lg:col-span-2" : ""}>
                    <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                      团队判断
                    </h2>
                    <div className="mt-3">
                      <JudgmentsByMember
                        projectId={projectId}
                        onHasData={setHasTeamJudgments}
                      />
                    </div>
                  </div>
                  <div className="space-y-6 rounded-lg border border-line bg-white p-4">
                    <ShareControl projectId={projectId} />
                    <CommentPanel
                      projectId={projectId}
                      currentUserId={currentUserId}
                    />
                  </div>
                </div>
              )}

              <DocumentPanel
                projectId={projectId}
                docMeta={docMeta}
                newUpload={newUpload}
                onUploadComplete={handleUploadComplete}
                onGenerate={handleGenerate}
              />

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)]">
                <section className="rounded-lg border border-line bg-white p-5">
                  <h2 className="text-sm font-semibold text-ink">材料文本</h2>
                  <p className="mt-2 text-xs text-ink-faint">
                    {docMeta.length > 0
                      ? docMeta
                          .map(
                            (d) =>
                              `${d.filename}（${d.chars.toLocaleString()} 字）`
                          )
                          .join("，")
                      : "尚未上传材料"}
                  </p>

                  <ImageAnalysisActions
                    docMeta={docMeta}
                    imgStates={imgStates}
                    quotaRemaining={quotaRemaining}
                    analyzeImages={analyzeImages}
                  />

                  <div className="mt-4 h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-xs leading-6 text-ink-soft">
                    {bpText || "暂无可显示文本"}
                  </div>
                </section>

                <section className="space-y-6 rounded-lg border border-line bg-white p-5">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      判断要点
                    </h2>
                    <p className="mt-1 text-xs text-ink-faint">
                      填入 3-10 条核心判断，报告会围绕这些问题展开。
                    </p>
                    <div className="mt-4 space-y-2">
                      {points.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-xs text-ink-faint">
                            {i + 1}
                          </span>
                          <input
                            value={p}
                            onChange={(e) => updatePoint(i, e.target.value)}
                            placeholder="一条你对该项目的核心判断"
                            className="flex-1 rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                          />
                          <button
                            onClick={() => removePoint(i)}
                            disabled={points.length <= 1}
                            className="px-1 text-ink-faint hover:text-ink disabled:opacity-30"
                            aria-label="删除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    {points.length < 10 && (
                      <button
                        onClick={addPoint}
                        className="mt-3 text-xs font-medium text-accent hover:underline"
                      >
                        + 添加一条
                      </button>
                    )}
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleGenerate}
                      className="min-w-[140px] flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#265b42]"
                    >
                      生成分析报告
                    </button>
                    <Link
                      href={`/projects/${projectId}/brief-analysis`}
                      className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface"
                    >
                      简要分析
                    </Link>
                    <Link
                      href={`/projects/${projectId}/term-sheet`}
                      className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface"
                    >
                      Term Sheet
                    </Link>
                    <button
                      onClick={() => setShowSkillModal(true)}
                      disabled={!hasParsedDoc}
                      title={hasParsedDoc ? undefined : "请先上传并解析项目文档"}
                      className="rounded-lg border border-accent px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint disabled:hover:bg-transparent"
                    >
                      SKILL 分析
                    </button>
                    <button
                      onClick={handleExtractFinancials}
                      disabled={finLoading}
                      className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
                    >
                      {finLoading ? "提取中…" : "提取财务数据"}
                    </button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    还没填判断？可以先做一份
                    <Link
                      href={`/projects/${projectId}/brief-analysis`}
                      className="mx-1 text-accent hover:underline"
                    >
                      简要分析
                    </Link>
                    存档。
                  </p>
                </section>
              </div>

              {(finLoading || finError || financials) && (
                <div className="mt-6 rounded-lg border border-line bg-white p-5">
                  <h2 className="text-sm font-semibold text-ink">财务数据</h2>
                  {finLoading ? (
                    <p className="py-8 text-center text-sm text-ink-faint">
                      AI 正在提取财务数据…
                    </p>
                  ) : finError ? (
                    <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                      {finError}
                    </p>
                  ) : financials ? (
                    <div className="mt-4">
                      <FinancialCharts data={financials} />
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        <WorkspaceRail
          nextAction={nextAction}
          evidenceNote={evidenceNote}
          parsedDocCount={parsedDocCount}
          docCount={docMeta.length}
          bpDocCount={bpDocCount}
          reportState={reportState}
          hasParsedDoc={hasParsedDoc}
          latestReportId={latestReportId}
          projectId={projectId}
        />
      </div>

      {showSkillModal && (
        <SkillRunModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setShowSkillModal(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

function WorkspaceMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-[#ece4d8] bg-white/70 p-4">
      <div className="text-lg font-semibold text-ink">{value}</div>
      <div className="mt-1 text-sm font-medium text-ink">{label}</div>
      <div className="mt-1 text-xs text-ink-soft">{note}</div>
    </div>
  );
}

function WorkspaceRail({
  nextAction,
  evidenceNote,
  parsedDocCount,
  docCount,
  bpDocCount,
  reportState,
  hasParsedDoc,
  latestReportId,
  projectId,
}: {
  nextAction: string;
  evidenceNote: string;
  parsedDocCount: number;
  docCount: number;
  bpDocCount: number;
  reportState: string;
  hasParsedDoc: boolean;
  latestReportId: string | null;
  projectId: string;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <div className="rounded-lg border border-[#e6ded1] bg-[#f7f2e8] p-4">
        <h2 className="text-sm font-semibold text-ink">下一步</h2>
        <p className="mt-3 text-sm leading-7 text-ink-soft">{nextAction}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={latestReportId ? `/projects/${projectId}/report` : "#"}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              latestReportId
                ? "border-line bg-white text-ink-soft hover:bg-surface"
                : "pointer-events-none border-line bg-white/60 text-ink-faint"
            }`}
          >
            查看报告
          </Link>
          <Link
            href={`/projects/${projectId}/brief-analysis`}
            className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
          >
            简要分析
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">证据状态</h2>
        <div className="mt-3 space-y-3 text-sm text-ink-soft">
          <RailRow label="材料解析" value={evidenceNote} />
          <RailRow label="BP 材料" value={`${bpDocCount} 份`} />
          <RailRow label="报告状态" value={reportState} />
        </div>
        {!hasParsedDoc && (
          <p className="mt-4 rounded-md bg-[#fff8e8] px-3 py-2 text-xs leading-5 text-[#8a5b1f]">
            先补充一份核心材料，后续判断、报告和 SKILL 分析会更稳。
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">近期活动</h2>
        <div className="mt-3 space-y-2 text-xs text-ink-soft">
          <p>已整理 {docCount} 份材料，其中 {parsedDocCount} 份可用于分析。</p>
          <p>团队判断、评论和分享仍保留在项目工作区内。</p>
          <p>后续可在这里接入会议、关系和投后更新。</p>
        </div>
      </div>
    </aside>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      <span className="text-right text-ink-soft">{value}</span>
    </div>
  );
}

function DocumentPanel({
  projectId,
  docMeta,
  newUpload,
  onUploadComplete,
  onGenerate,
}: {
  projectId: string;
  docMeta: DocMeta[];
  newUpload: boolean;
  onUploadComplete: (results: UploadResult[]) => void;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">项目材料</h2>
      <div className="mt-3">
        <FileUploader
          target="project"
          projectId={projectId}
          onUploadComplete={onUploadComplete}
        />
      </div>

      {newUpload && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-accent-soft px-3 py-2 text-xs text-accent">
          <span>新文件已解析完成。</span>
          <button onClick={onGenerate} className="shrink-0 font-medium hover:underline">
            重新生成分析报告
          </button>
        </div>
      )}

      {docMeta.length > 0 && (
        <ul className="mt-4 space-y-2">
          {docMeta.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-xs text-ink-soft"
            >
              <span className="rounded bg-surface px-1.5 py-0.5 font-medium text-ink-soft">
                {FILE_TYPE_LABEL[d.fileType] ?? "DOC"}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{d.filename}</span>
              <span className="hidden text-ink-faint sm:inline">
                {new Date(d.uploadedAt).toLocaleDateString("zh-CN")}
              </span>
              <span className={d.parseStatus === "done" ? "text-accent" : "text-ink-faint"}>
                {d.parseStatus === "done" ? "已解析" : d.parseStatus}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImageAnalysisActions({
  docMeta,
  imgStates,
  quotaRemaining,
  analyzeImages,
}: {
  docMeta: DocMeta[];
  imgStates: Record<string, ImgState>;
  quotaRemaining: number | null;
  analyzeImages: (docId: string) => void;
}) {
  return (
    <>
      {docMeta
        .filter((d) => d.docKind === "bp")
        .map((d) => {
          const st = imgStates[d.id];
          if (!st || st.loading || !st.supported) return null;
          if (!st.analyzed && st.imageCount === 0) return null;
          const insufficient =
            !st.analyzed &&
            quotaRemaining !== null &&
            quotaRemaining < st.imageCount * EST_TOKENS_PER_IMAGE;
          return (
            <div key={d.id} className="mt-3 text-xs">
              {st.analyzed ? (
                <p className="text-accent">
                  已提取图片信息{st.note ? `：${st.note}` : ""}
                </p>
              ) : (
                <>
                  <button
                    onClick={() => analyzeImages(d.id)}
                    disabled={st.analyzing}
                    className="rounded-md border border-accent px-3 py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
                  >
                    {st.analyzing
                      ? "识别中，可继续其他操作"
                      : `提取图片信息（${st.imageCount} 张，约 ${estimateMinutes(
                          st.imageCount
                        )} 分钟）`}
                  </button>
                  {insufficient && (
                    <p className="mt-1 text-amber-700">
                      当前剩余额度可能不足以完成图片识别，建议配置自己的 API Key。
                    </p>
                  )}
                  {st.error && <p className="mt-1 text-red-600">{st.error}</p>}
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
