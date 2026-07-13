"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FinancialCharts } from "./FinancialCharts";
import type { Judgment } from "./StageProgress";
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
import { OUTCOMES, outcomeDef } from "@/lib/outcome";
import { FLOW_STAGES, TERMINAL_STAGES, STAGE_LABELS } from "@/lib/stages";
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

interface ReportMeta {
  id: string;
  title: string;
  status: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

interface MeetingMeta {
  id: string;
  title: string;
  meeting_date: string | null;
  meeting_type: string;
  created_at: string;
}

interface UpdateMeta {
  id: string;
  update_type: string;
  period: string | null;
  created_at: string;
}

interface WorkflowMeta {
  nextAction: string | null;
  nextActionDueAt: string | null;
  evidenceCompleteness: number | null;
  workspaceNote: string | null;
}

interface DecisionEventMeta {
  id: string;
  stage: string;
  event_type: string;
  status: string;
  title: string;
  note: string | null;
  created_at: string;
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
  reports: ReportMeta[];
  meetings: MeetingMeta[];
  updates: UpdateMeta[];
  decisionEvents: DecisionEventMeta[];
  projectCreatedAt: string;
  processStageUpdatedAt: string | null;
  outcomeAt: string | null;
  workflow: WorkflowMeta;
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
  reports,
  meetings,
  updates,
  decisionEvents,
  projectCreatedAt,
  processStageUpdatedAt,
  outcomeAt,
  workflow,
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
  const [workflowState, setWorkflowState] = useState<WorkflowMeta>(workflow);
  const [decisionEventState, setDecisionEventState] =
    useState<DecisionEventMeta[]>(decisionEvents);

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
  const reportState = latestReportId ? "已有分析报告" : "等待生成报告";
  const judgmentCount = judgments.length;
  const hasJudgment = judgmentCount > 0;
  const judgmentPointCount = points.map((p) => p.trim()).filter(Boolean).length;
  const workspaceState = buildWorkspaceState({
    processStage,
    hasParsedDoc,
    hasJudgment,
    latestReportId,
  });
  const evidenceNote =
    docMeta.length === 0
      ? "尚未看到项目材料"
      : `${parsedDocCount}/${docMeta.length} 份材料已解析`;
  const evidenceItems = buildEvidenceItems({
    docCount: docMeta.length,
    parsedDocCount,
    bpDocCount,
    hasJudgment,
    latestReportId,
    processStage,
  });
  const effectiveCompleteness =
    workflowState.evidenceCompleteness ?? estimateEvidenceCompleteness(evidenceItems);
  const activityItems = buildActivityItems({
    projectId,
    projectCreatedAt,
    processStage,
    processStageUpdatedAt,
    outcome,
    outcomeAt,
    docMeta,
    judgments,
  reports,
  meetings,
  updates,
  decisionEvents: decisionEventState,
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5 lg:px-8">
      <div className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-ink">
                {projectName}
              </h1>
              <span className="rounded-full border border-[#dfd4c4] bg-white px-2.5 py-1 text-xs font-medium text-ink-soft">
                {STAGE_LABELS[processStage] ?? processStage}
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
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
              <span>
                下一步：
                <span className="font-medium text-ink">
                  {workflowState.nextAction || workspaceState.title}
                </span>
              </span>
              <span>
                证据完整度：
                <span className="font-medium text-ink">{effectiveCompleteness}%</span>
              </span>
              <span>
                项目记录：
                <span className="font-medium text-ink">{activityItems.length} 条</span>
              </span>
            </div>
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
      </div>

      <ActivityTimeline items={activityItems} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex gap-1 border-b border-line">
            {([
              ["analysis", "项目分析"],
              ["decision", "投资决策"],
              ["post", processStage === "post_investment" || outcome === "invested" ? "投后管理" : "投后规划"],
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
            <div className="mt-6 space-y-6">
              <ICMemoWorkspace
                projectId={projectId}
                projectName={projectName}
                processStage={processStage}
                outcome={outcome}
                outcomeNote={outcomeNote}
                judgments={judgments}
                docMeta={docMeta}
                reports={reports}
                meetings={meetings}
                workflow={workflowState}
                decisionEvents={decisionEventState}
                onDecisionEventCreated={(event) =>
                  setDecisionEventState((prev) => [event, ...prev])
                }
                evidenceItems={evidenceItems}
                evidenceCompleteness={effectiveCompleteness}
                latestReportId={latestReportId}
                judgmentPointCount={judgmentPointCount}
                onGenerateReport={handleGenerate}
                onSelectTab={setTab}
              />
              <DecisionTools projectId={projectId} processStage={processStage} />
            </div>
          )}

          {tab === "post" && (
            <PostInvestment
              projectId={projectId}
              docMeta={docMeta}
              onUploadComplete={handleUploadComplete}
            />
          )}

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
                evidenceItems={evidenceItems}
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
          workspaceState={workspaceState}
          evidenceNote={evidenceNote}
          evidenceItems={evidenceItems}
          bpDocCount={bpDocCount}
          reportState={reportState}
          evidenceCompleteness={effectiveCompleteness}
          nextAction={workflowState.nextAction}
          nextActionDueAt={workflowState.nextActionDueAt}
          judgmentCount={judgmentCount}
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

function ICMemoWorkspace({
  projectId,
  projectName,
  processStage,
  outcome,
  outcomeNote,
  judgments,
  docMeta,
  reports,
  meetings,
  workflow,
  decisionEvents,
  onDecisionEventCreated,
  evidenceItems,
  evidenceCompleteness,
  latestReportId,
  judgmentPointCount,
  onGenerateReport,
  onSelectTab,
}: {
  projectId: string;
  projectName: string;
  processStage: string;
  outcome: string | null;
  outcomeNote: string | null;
  judgments: Judgment[];
  docMeta: DocMeta[];
  reports: ReportMeta[];
  meetings: MeetingMeta[];
  workflow: WorkflowMeta;
  decisionEvents: DecisionEventMeta[];
  onDecisionEventCreated: (event: DecisionEventMeta) => void;
  evidenceItems: EvidenceItem[];
  evidenceCompleteness: number;
  latestReportId: string | null;
  judgmentPointCount: number;
  onGenerateReport: () => void;
  onSelectTab: (tab: Tab) => void;
}) {
  const latestJudgment = judgments[0] ?? null;
  const parsedDocs = docMeta.filter((doc) => doc.parseStatus === "done");
  const analysisReports = reports.filter((report) =>
    ["analysis", "brief", "competitive_landscape"].includes(report.kind)
  );
  const memoReadiness = buildMemoReadiness({
    parsedDocCount: parsedDocs.length,
    judgmentCount: judgments.length,
    reportCount: analysisReports.length,
    evidenceCompleteness,
    meetingCount: meetings.length,
  });
  const openQuestions = buildOpenQuestions({
    evidenceItems,
    workflow,
    latestJudgment,
    latestReportId,
    evidenceCompleteness,
  });
  const canGenerateAnalysisReport =
    judgmentPointCount >= 3 && judgmentPointCount <= 10;

  return (
    <section className="space-y-4">
      <DecisionGatePanel
        projectId={projectId}
        processStage={processStage}
        decisionEvents={decisionEvents}
        onCreated={onDecisionEventCreated}
      />

      <div className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            IC Memo
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            投委会工作区
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-ink-soft">
            把材料、判断、报告和未解决问题整理成一份会前可讨论的决策包。这里先帮助你看清
            {projectName} 当前是否具备进入投委会讨论的基础。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
          <p className="text-xs text-ink-faint">准备度</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {memoReadiness.score}%
          </p>
          <p className="mt-1 text-xs text-ink-soft">{memoReadiness.label}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <MemoMetric
          label="当前阶段"
          value={STAGE_LABELS[processStage] ?? processStage}
          note="以项目当前状态为准"
        />
        <MemoMetric
          label="判断记录"
          value={`${judgments.length} 条`}
          note={
            latestJudgment
              ? compactText(latestJudgment.key_hypothesis || latestJudgment.bear_case)
              : "会前建议先留下一条当前判断"
          }
        />
        <MemoMetric
          label="材料与报告"
          value={`${parsedDocs.length} / ${analysisReports.length}`}
          note="已解析材料 / 可引用报告"
        />
        <MemoMetric
          label="投资结果"
          value={outcome ? outcomeDef(outcome).label : "待定"}
          note={outcomeNote || "可在项目当前状态中维护"}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Memo 结构</h3>
            <span className="rounded-full bg-surface px-2 py-1 text-[11px] text-ink-soft">
              会前底稿
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {buildMemoSections({
              latestJudgment,
              evidenceCompleteness,
              reportCount: analysisReports.length,
              meetingCount: meetings.length,
              workflow,
            }).map((section) => (
              <div
                key={section.title}
                className="rounded-md border border-line bg-[#fffdfa] px-3 py-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      section.ready ? "bg-accent" : "bg-[#d79b35]"
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">{section.title}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-soft">
                      {section.note}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">会前未决问题</h3>
          <div className="mt-4 space-y-3">
            {openQuestions.map((question) => (
              <div key={question} className="rounded-md bg-surface px-3 py-2">
                <p className="text-xs leading-5 text-ink-soft">{question}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs leading-5 text-ink-soft">
              建议在会议前把未决问题收敛到 3-5 个。问题不必全部解决，但需要明确哪些会影响投资结论。
            </p>
          </div>
        </div>
      </div>

      {!canGenerateAnalysisReport && (
        <p className="mt-4 text-xs leading-5 text-ink-soft">
          生成分析报告前，需要先在“项目分析”中补充 3-10 条判断要点。
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canGenerateAnalysisReport ? (
          <button
            onClick={onGenerateReport}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-[#265b42]"
          >
            生成分析报告
          </button>
        ) : (
          <button
            onClick={() => onSelectTab("analysis")}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-[#265b42]"
          >
            先补判断要点
          </button>
        )}
        <Link
          href={`/projects/${projectId}/brief-analysis`}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
        >
          生成一页简报
        </Link>
        <Link
          href={`/projects/${projectId}/term-sheet`}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
        >
          准备条款草案
        </Link>
        {latestReportId && (
          <Link
            href={`/projects/${projectId}/report`}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
          >
            查看已有报告
          </Link>
        )}
        <button
          onClick={() => onSelectTab("analysis")}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
        >
          回到材料与判断
        </button>
      </div>
      </div>
    </section>
  );
}

const DECISION_EVENT_TYPES = [
  { value: "stage_gate", label: "阶段节点" },
  { value: "project_approval", label: "立项决策" },
  { value: "ic_memo", label: "IC Memo" },
  { value: "ic_decision", label: "投委会决议" },
  { value: "term_decision", label: "条款决策" },
  { value: "post_investment", label: "投后节点" },
  { value: "exit_decision", label: "退出决策" },
];

const DECISION_EVENT_STATUS = [
  { value: "draft", label: "草稿" },
  { value: "submitted", label: "待审议" },
  { value: "approved", label: "通过" },
  { value: "rejected", label: "否决" },
  { value: "deferred", label: "暂缓" },
  { value: "needs_more", label: "需补充材料" },
  { value: "recorded", label: "已记录" },
];

function DecisionGatePanel({
  projectId,
  processStage,
  decisionEvents,
  onCreated,
}: {
  projectId: string;
  processStage: string;
  decisionEvents: DecisionEventMeta[];
  onCreated: (event: DecisionEventMeta) => void;
}) {
  const [stage, setStage] = useState(processStage);
  const [eventType, setEventType] = useState(
    processStage === "investment_committee" ? "ic_decision" : "stage_gate"
  );
  const [status, setStatus] = useState("recorded");
  const [title, setTitle] = useState(defaultDecisionTitle(processStage));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const latestEvent = decisionEvents[0] ?? null;

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${projectId}/decision-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          event_type: eventType,
          status,
          title,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "节点记录保存失败");
      }
      onCreated(data.event as DecisionEventMeta);
      setNote("");
      setMessage("节点记录已保存。项目阶段已同步更新。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "节点记录保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[#e6ded1] bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Decision Gate
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink">投资节点控制</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-ink-soft">
            用正式节点记录支撑流程推进。分析、Memo 和辅助工具服务于节点，节点记录保留结论和依据。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
          最近节点：
          <span className="ml-1 font-medium text-ink">
            {latestEvent
              ? `${eventLabel(latestEvent.event_type)} · ${statusLabel(latestEvent.status)}`
              : "尚未记录"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[160px_170px_150px_minmax(0,1fr)]">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">流程节点</span>
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setTitle(defaultDecisionTitle(e.target.value));
            }}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {[...FLOW_STAGES, ...TERMINAL_STAGES].map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">节点类型</span>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {DECISION_EVENT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">节点结果</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {DECISION_EVENT_STATUS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">节点标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-ink-soft">结论与依据</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="记录通过、否决、暂缓或需补充材料的原因。"
          className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {decisionEvents.slice(0, 4).map((event) => (
            <span
              key={event.id}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft"
            >
              {formatShortDate(event.created_at)} · {eventLabel(event.event_type)} ·{" "}
              {statusLabel(event.status)}
            </span>
          ))}
        </div>
        <button
          onClick={save}
          disabled={saving || !title.trim()}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存节点记录"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-ink-soft">{message}</p>}
    </div>
  );
}

function defaultDecisionTitle(stage: string): string {
  if (stage === "screening") return "初筛判断";
  if (stage === "due_diligence") return "立项 / 尽调节点";
  if (stage === "investment_committee") return "投委会决议";
  if (stage === "post_investment") return "进入投后管理";
  if (stage === "passed") return "项目 Pass";
  if (stage === "exited") return "退出记录";
  return "节点记录";
}

function eventLabel(value: string): string {
  return DECISION_EVENT_TYPES.find((item) => item.value === value)?.label ?? value;
}

function statusLabel(value: string): string {
  return DECISION_EVENT_STATUS.find((item) => item.value === value)?.label ?? value;
}

function MemoMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-2 text-lg font-semibold text-ink">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">{note}</p>
    </div>
  );
}

function buildMemoReadiness({
  parsedDocCount,
  judgmentCount,
  reportCount,
  evidenceCompleteness,
  meetingCount,
}: {
  parsedDocCount: number;
  judgmentCount: number;
  reportCount: number;
  evidenceCompleteness: number;
  meetingCount: number;
}) {
  const base = Math.round(evidenceCompleteness * 0.45);
  const docs = parsedDocCount > 0 ? 18 : 0;
  const judgments = judgmentCount > 0 ? 18 : 0;
  const reports = reportCount > 0 ? 14 : 0;
  const meetings = meetingCount > 0 ? 5 : 0;
  const score = Math.min(100, base + docs + judgments + reports + meetings);
  const label =
    score >= 80
      ? "可以进入会前讨论"
      : score >= 55
        ? "已有底稿，仍建议补齐关键证据"
        : "先补材料、判断和分析底稿";
  return { score, label };
}

function buildMemoSections({
  latestJudgment,
  evidenceCompleteness,
  reportCount,
  meetingCount,
  workflow,
}: {
  latestJudgment: Judgment | null;
  evidenceCompleteness: number;
  reportCount: number;
  meetingCount: number;
  workflow: WorkflowMeta;
}) {
  return [
    {
      title: "投资建议",
      ready: !!latestJudgment,
      note: latestJudgment
        ? compactText(latestJudgment.bull_case || latestJudgment.key_hypothesis)
        : "先记录一条当前判断，明确为什么继续看、为什么暂缓或为什么 Pass。",
    },
    {
      title: "关键证据",
      ready: evidenceCompleteness >= 60,
      note:
        evidenceCompleteness >= 60
          ? `当前证据完整度为 ${evidenceCompleteness}%，可以支撑初步讨论。`
          : `当前证据完整度为 ${evidenceCompleteness}%，建议补齐核心材料和验证信息。`,
    },
    {
      title: "主要风险",
      ready: !!latestJudgment?.bear_case,
      note: latestJudgment?.bear_case
        ? compactText(latestJudgment.bear_case)
        : "把最可能改变投资结论的风险写清楚，会议讨论会更集中。",
    },
    {
      title: "待验证假设",
      ready: !!latestJudgment?.key_hypothesis || !!workflow.nextAction,
      note:
        latestJudgment?.key_hypothesis ||
        workflow.nextAction ||
        "列出接下来最需要验证的一件事，并放回项目当前状态持续跟踪。",
    },
    {
      title: "材料与报告",
      ready: reportCount > 0,
      note:
        reportCount > 0
          ? `已有 ${reportCount} 份可引用分析输出。`
          : "生成分析报告或一页简报后，可以作为 IC Memo 的底稿。",
    },
    {
      title: "会议记录",
      ready: meetingCount > 0,
      note:
        meetingCount > 0
          ? `已有 ${meetingCount} 条会议记录可回看。`
          : "如已和创始人、专家或内部成员讨论，建议补一条会议记录。",
    },
  ];
}

function buildOpenQuestions({
  evidenceItems,
  workflow,
  latestJudgment,
  latestReportId,
  evidenceCompleteness,
}: {
  evidenceItems: EvidenceItem[];
  workflow: WorkflowMeta;
  latestJudgment: Judgment | null;
  latestReportId: string | null;
  evidenceCompleteness: number;
}) {
  const questions: string[] = [];
  const missingEvidence = evidenceItems.filter((item) => !item.done).slice(0, 2);
  for (const item of missingEvidence) {
    questions.push(`${item.label}：${item.note}`);
  }
  if (!latestJudgment?.bear_case) {
    questions.push("这笔投资最需要被反驳的风险是什么？");
  }
  if (!latestJudgment?.key_hypothesis) {
    questions.push("如果只能验证一个假设，哪一项会最直接影响是否继续推进？");
  }
  if (!latestReportId) {
    questions.push("是否需要先形成一版分析报告，作为投委会讨论底稿？");
  }
  if (evidenceCompleteness < 70 && workflow.nextAction) {
    questions.push(`下一步是否仍是：${workflow.nextAction}`);
  }
  return questions.slice(0, 5);
}

function WorkflowPanel({
  projectId,
  initialWorkflow,
  fallbackNextAction,
  fallbackCompleteness,
  initialStage,
  initialOutcome,
  initialOutcomeNote,
  onSaved,
}: {
  projectId: string;
  initialWorkflow: WorkflowMeta;
  fallbackNextAction: string;
  fallbackCompleteness: number;
  initialStage: string;
  initialOutcome: string | null;
  initialOutcomeNote: string | null;
  onSaved: (workflow: WorkflowMeta) => void;
}) {
  const router = useRouter();
  const [stage, setStage] = useState(initialStage);
  const [outcome, setOutcome] = useState(initialOutcome || "pending");
  const [outcomeNote, setOutcomeNote] = useState(initialOutcomeNote || "");
  const [nextAction, setNextAction] = useState(initialWorkflow.nextAction ?? "");
  const [dueAt, setDueAt] = useState(dateInputValue(initialWorkflow.nextActionDueAt));
  const [completeness, setCompleteness] = useState(
    String(initialWorkflow.evidenceCompleteness ?? fallbackCompleteness)
  );
  const [note, setNote] = useState(initialWorkflow.workspaceNote ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      if (stage !== initialStage) {
        const stageRes = await fetch(`/api/projects/${projectId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        if (!stageRes.ok) {
          throw new Error(await readError(stageRes, "阶段保存失败"));
        }
      }

      if (outcome !== (initialOutcome || "pending") || outcomeNote !== (initialOutcomeNote || "")) {
        const outcomeRes = await fetch(`/api/projects/${projectId}/outcome`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome, outcome_note: outcomeNote }),
        });
        if (!outcomeRes.ok) {
          throw new Error(await readError(outcomeRes, "投资结果保存失败"));
        }
      }

      const res = await fetch(`/api/projects/${projectId}/workflow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextAction,
          nextActionDueAt: dueAt,
          evidenceCompleteness: Number(completeness),
          workspaceNote: note,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "保存失败"));
      }
      const data = await res.json();
      const saved = data.workflow ?? {};
      const next = {
        nextAction: saved.next_action ?? null,
        nextActionDueAt: saved.next_action_due_at ?? null,
        evidenceCompleteness: saved.evidence_completeness ?? null,
        workspaceNote: saved.workspace_note ?? null,
      };
      onSaved(next);
      setNextAction(next.nextAction ?? "");
      setDueAt(dateInputValue(next.nextActionDueAt));
      setCompleteness(String(next.evidenceCompleteness ?? fallbackCompleteness));
      setNote(next.workspaceNote ?? "");
      setMessage("已保存");
      if (stage !== initialStage || outcome !== (initialOutcome || "pending")) {
        router.refresh();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">项目当前状态</h2>
          <p className="mt-1 text-xs text-ink-faint">
            这里记录当前阶段下最需要推进的一件事，以及做出判断前还需要补齐的证据。
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">项目阶段</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {[...FLOW_STAGES, ...TERMINAL_STAGES].map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">投资结果</span>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">结果备注</span>
          <input
            value={outcomeNote}
            onChange={(e) => setOutcomeNote(e.target.value)}
            placeholder="例如：等待投委会讨论、已决定继续观察"
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_160px_180px]">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">下一步动作</span>
          <input
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder={fallbackNextAction}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">截止日期</span>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">证据完整度</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={completeness}
              onChange={(e) => setCompleteness(e.target.value)}
              className="min-w-0 flex-1 accent-[#2f6f4f]"
            />
            <span className="w-10 text-right text-sm font-medium text-ink">
              {completeness}%
            </span>
          </div>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-ink-soft">工作备注</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="记录当前卡点、待确认事项或会议前需要补充的信息"
          className="mt-1 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>
      {message && <p className="mt-2 text-xs text-ink-soft">{message}</p>}
    </section>
  );
}

interface ActivityItem {
  id: string;
  type:
    | "project"
    | "stage"
    | "decision"
    | "material"
    | "judgment"
    | "report"
    | "meeting"
    | "update";
  label: string;
  title: string;
  detail: string;
  date: string;
  href?: string;
}

const REPORT_KIND_LABEL: Record<string, string> = {
  analysis: "分析报告",
  brief: "简要分析",
  term_sheet: "Term Sheet",
  committee: "投委会总报告",
  lp_report: "LP 报告",
  competitive_landscape: "竞争格局",
};

const MEETING_TYPE_LABEL: Record<string, string> = {
  founder: "创始人访谈",
  expert: "专家访谈",
  lp: "LP 沟通",
  post_invest: "投后会议",
  internal: "内部讨论",
  regular: "会议",
  other: "会议",
};

const UPDATE_TYPE_LABEL: Record<string, string> = {
  regular: "常规更新",
  metric: "指标更新",
  risk: "风险事件",
  financing: "融资进展",
  milestone: "里程碑",
};

function buildActivityItems({
  projectId,
  projectCreatedAt,
  processStage,
  processStageUpdatedAt,
  outcome,
  outcomeAt,
  docMeta,
  judgments,
  reports,
  meetings,
  updates,
  decisionEvents,
}: {
  projectId: string;
  projectCreatedAt: string;
  processStage: string;
  processStageUpdatedAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  docMeta: DocMeta[];
  judgments: Judgment[];
  reports: ReportMeta[];
  meetings: MeetingMeta[];
  updates: UpdateMeta[];
  decisionEvents: DecisionEventMeta[];
}): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      id: "project-created",
      type: "project",
      label: "项目",
      title: "项目进入工作区",
      detail: "后续材料、判断和报告都会沉淀在这里。",
      date: projectCreatedAt,
    },
  ];

  if (processStageUpdatedAt) {
    items.push({
      id: "stage-updated",
      type: "stage",
      label: "阶段",
      title: `阶段更新为 ${STAGE_LABELS[processStage] ?? "待整理"}`,
      detail: "项目流程位置已更新，可继续补充当前阶段判断。",
      date: processStageUpdatedAt,
    });
  }

  if (outcome && outcome !== "pending" && outcomeAt) {
    items.push({
      id: "outcome-updated",
      type: "stage",
      label: "结论",
      title: `结论更新为 ${outcomeDef(outcome).label}`,
      detail: "项目结论已记录，后续可继续沉淀原因和复盘。",
      date: outcomeAt,
    });
  }

  for (const event of decisionEvents) {
    items.push({
      id: `decision-${event.id}`,
      type: "decision",
      label: eventLabel(event.event_type),
      title: `${event.title} · ${statusLabel(event.status)}`,
      detail:
        event.note ||
        `${STAGE_LABELS[event.stage] ?? event.stage} 阶段的正式节点记录。`,
      date: event.created_at,
    });
  }

  for (const doc of docMeta) {
    items.push({
      id: `doc-${doc.id}`,
      type: "material",
      label: "材料",
      title: doc.filename,
      detail:
        doc.parseStatus === "done"
          ? `${FILE_TYPE_LABEL[doc.fileType] ?? "DOC"} · ${doc.chars.toLocaleString()} 字可用于分析`
          : `${FILE_TYPE_LABEL[doc.fileType] ?? "DOC"} · 解析状态：${doc.parseStatus}`,
      date: doc.uploadedAt,
    });
  }

  for (const judgment of judgments) {
    items.push({
      id: `judgment-${judgment.id}`,
      type: "judgment",
      label: "判断",
      title: `${STAGE_LABELS[judgment.stage] ?? judgment.stage}阶段判断`,
      detail: compactText(judgment.key_hypothesis || judgment.bull_case || judgment.bear_case),
      date: judgment.created_at,
    });
  }

  for (const report of reports) {
    const kind = REPORT_KIND_LABEL[report.kind] ?? "报告";
    items.push({
      id: `report-${report.id}`,
      type: "report",
      label: kind,
      title: report.title || kind,
      detail: report.status === "finalized" ? "已定稿" : "草稿可继续打磨",
      date: report.updated_at || report.created_at,
      href: `/projects/${projectId}/report?reportId=${report.id}`,
    });
  }

  for (const meeting of meetings) {
    items.push({
      id: `meeting-${meeting.id}`,
      type: "meeting",
      label: MEETING_TYPE_LABEL[meeting.meeting_type] ?? "会议",
      title: meeting.title,
      detail: meeting.meeting_date
        ? `会议日期 ${formatShortDate(meeting.meeting_date)}`
        : "会议记录已保存",
      date: meeting.meeting_date || meeting.created_at,
    });
  }

  for (const update of updates) {
    const label = UPDATE_TYPE_LABEL[update.update_type] ?? "投后更新";
    items.push({
      id: `update-${update.id}`,
      type: "update",
      label,
      title: update.period ? `${label} · ${update.period}` : label,
      detail: "投后跟踪信息已记录。",
      date: update.created_at,
    });
  }

  return items
    .filter((item) => !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 12);
}

function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  const latestItem = items[0];

  return (
    <section className="mt-4 rounded-lg border border-line bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">项目记录</h2>
          <p className="mt-1 text-xs text-ink-faint">
            最新进展在最左侧，后续记录按时间向右展开。
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft">
          {items.length} 条
        </span>
      </div>

      <ol className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {items.map((item, index) => (
          <li key={item.id} className="relative min-w-[220px] max-w-[260px]">
            <div className="absolute left-4 right-0 top-[18px] h-px bg-line" />
            <div
              className={`relative rounded-lg border p-3 ${
                index === 0
                  ? "border-[#d8c8b2] bg-[#fffdfa]"
                  : "border-line bg-surface"
              }`}
            >
              <span className="absolute left-3 top-3 h-2.5 w-2.5 rounded-full border border-white bg-accent" />
              <div className="min-h-[76px] pl-4">
                <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                  {item.label}
                </span>
                  <time className="text-[11px] text-ink-faint">
                    {formatShortDate(item.date)}
                  </time>
                </div>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="mt-2 block line-clamp-2 text-sm font-medium leading-5 text-ink hover:text-accent"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="mt-2 block line-clamp-2 text-sm font-medium leading-5 text-ink">
                    {item.title}
                  </span>
                )}
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">
                  {item.detail}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {latestItem && (
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          最近进展：{latestItem.title}。需要继续推进时，可直接进入下方主流程处理。
        </p>
      )}
    </section>
  );
}

function compactText(value: string | null | undefined): string {
  const text = (value || "已记录一条阶段判断。").replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function formatFullDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN");
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

interface WorkspaceState {
  title: string;
  description: string;
  badge: string;
  actions: Array<
    | { label: string; kind: "tab"; tab: Tab; primary?: boolean }
    | { label: string; kind: "generate"; primary?: boolean }
  >;
}

interface EvidenceItem {
  label: string;
  note: string;
  done: boolean;
}

function buildWorkspaceState({
  processStage,
  hasParsedDoc,
  hasJudgment,
  latestReportId,
}: {
  processStage: string;
  hasParsedDoc: boolean;
  hasJudgment: boolean;
  latestReportId: string | null;
}): WorkspaceState {
  if (!hasParsedDoc) {
    return {
      title: "先补齐核心材料",
      description:
        "还缺少可用于分析的材料。先放入 BP、财务模型或项目更新，后续判断和报告会更稳。",
      badge: "材料优先",
      actions: [{ label: "上传材料", kind: "tab", tab: "analysis" }],
    };
  }

  if (!hasJudgment) {
    return {
      title: "补一条当前判断",
      description:
        "材料已经就绪。可以先记录你现在最关心的判断点，再生成报告或进入投资决策。",
      badge: "进入判断",
      actions: [{ label: "记录判断", kind: "tab", tab: "analysis", primary: true }],
    };
  }

  if (processStage === "investment_committee") {
    return {
      title: "准备投委会讨论",
      description:
        "这个项目已经进入投委会语境。建议围绕证据、分歧和未解决问题整理一份可讨论的决策包。",
      badge: "投委会准备",
      actions: [
        { label: "投资决策", kind: "tab", tab: "decision", primary: true },
        { label: "整理材料", kind: "tab", tab: "analysis" },
      ],
    };
  }

  if (latestReportId) {
    return {
      title: "回看报告与下一步",
      description:
        "已有分析报告。你可以继续打磨报告，也可以从反方视角或历史镜像里检查当前判断。",
      badge: "可复盘",
      actions: [
        { label: "投资决策", kind: "tab", tab: "decision", primary: true },
        { label: "补充材料", kind: "tab", tab: "analysis" },
      ],
    };
  }

  return {
    title: "生成第一版分析",
    description:
      "材料和判断都已具备，可以先生成一版报告，形成后续尽调和团队讨论的共同底稿。",
    badge: "形成底稿",
    actions: [{ label: "生成报告", kind: "generate", primary: true }],
  };
}

function buildEvidenceItems({
  docCount,
  parsedDocCount,
  bpDocCount,
  hasJudgment,
  latestReportId,
  processStage,
}: {
  docCount: number;
  parsedDocCount: number;
  bpDocCount: number;
  hasJudgment: boolean;
  latestReportId: string | null;
  processStage: string;
}): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      label: "核心材料",
      done: parsedDocCount > 0,
      note:
        parsedDocCount > 0
          ? `${parsedDocCount}/${docCount} 份材料可用于分析`
          : "先上传 BP、商业计划书或项目更新",
    },
    {
      label: "BP 线索",
      done: bpDocCount > 0,
      note:
        bpDocCount > 0
          ? `已识别 ${bpDocCount} 份 BP 类材料`
          : "如果已有 BP，建议单独上传为项目材料",
    },
    {
      label: "投资判断",
      done: hasJudgment,
      note: hasJudgment ? "已有阶段判断记录" : "可以先记录当前看多、看空和关键假设",
    },
    {
      label: "分析底稿",
      done: !!latestReportId,
      note: latestReportId ? "已有可复用报告" : "生成后可作为尽调和 IC 讨论底稿",
    },
  ];

  if (processStage === "investment_committee") {
    items.push({
      label: "IC 语境",
      done: !!latestReportId && hasJudgment,
      note:
        latestReportId && hasJudgment
          ? "已有进入会议讨论的基本材料"
          : "进入 IC 前建议补齐报告和阶段判断",
    });
  }

  return items;
}

function estimateEvidenceCompleteness(items: EvidenceItem[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((item) => item.done).length;
  return Math.round((done / items.length) * 100);
}

function WorkspaceRail({
  workspaceState,
  evidenceNote,
  evidenceItems,
  bpDocCount,
  reportState,
  evidenceCompleteness,
  nextAction,
  nextActionDueAt,
  judgmentCount,
  latestReportId,
  projectId,
}: {
  workspaceState: WorkspaceState;
  evidenceNote: string;
  evidenceItems: EvidenceItem[];
  bpDocCount: number;
  reportState: string;
  evidenceCompleteness: number;
  nextAction: string | null;
  nextActionDueAt: string | null;
  judgmentCount: number;
  latestReportId: string | null;
  projectId: string;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <div className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">判断依据</h2>
        <div className="mt-3 space-y-3 text-sm text-ink-soft">
          <RailRow label="完整度" value={`${evidenceCompleteness}%`} />
          <RailRow label="当前动作" value={nextAction || workspaceState.title} />
          <RailRow label="截止日期" value={nextActionDueAt ? formatFullDate(nextActionDueAt) : "未设定"} />
          <RailRow label="材料解析" value={evidenceNote} />
          <RailRow label="BP 材料" value={`${bpDocCount} 份`} />
          <RailRow label="判断记录" value={`${judgmentCount} 条`} />
          <RailRow label="报告状态" value={reportState} />
        </div>
        <div className="mt-4 space-y-2">
          {evidenceItems.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-xs leading-5"
            >
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  item.done ? "bg-accent" : "bg-[#d79b35]"
                }`}
              />
              <div>
                <p className="font-medium text-ink">{item.label}</p>
                <p className="mt-0.5 text-ink-soft">{item.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">投委会准备</h2>
        <p className="mt-2 text-xs leading-5 text-ink-soft">
          把当前材料、判断和报告整理成可讨论的决策包，方便会前快速对齐证据、分歧和下一步。
        </p>
        <div className="mt-4 grid gap-2">
          <Link
            href={`/projects/${projectId}/report`}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              latestReportId
                ? "border-line text-ink-soft hover:bg-surface"
                : "pointer-events-none border-line text-ink-faint"
            }`}
          >
            整理已有报告
          </Link>
          <Link
            href={`/projects/${projectId}/brief-analysis`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
          >
            生成一页简报
          </Link>
          <Link
            href={`/projects/${projectId}/term-sheet`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
          >
            准备条款草案
          </Link>
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

const DOC_KIND_LABELS: Record<string, string> = {
  bp: "商业计划书",
  financial_model: "财务模型",
  research: "研究材料",
  contract: "交易文件",
  other: "其他材料",
};

function groupDocuments(docMeta: DocMeta[]) {
  const order = ["bp", "financial_model", "research", "contract", "other"];
  return order
    .map((kind) => ({
      kind,
      label: DOC_KIND_LABELS[kind] ?? "其他材料",
      docs: docMeta.filter((doc) => (doc.docKind || "other") === kind),
    }))
    .filter((group) => group.docs.length > 0);
}

function materialSuggestions(docMeta: DocMeta[]): string[] {
  const kinds = new Set(docMeta.map((doc) => doc.docKind));
  const suggestions: string[] = [];
  if (!kinds.has("bp")) suggestions.push("商业计划书或项目介绍");
  if (!kinds.has("financial_model")) suggestions.push("财务模型或收入拆分");
  if (!kinds.has("research")) suggestions.push("行业研究、竞品或市场材料");
  if (!kinds.has("contract")) suggestions.push("核心交易文件或条款草案");
  return suggestions.slice(0, 3);
}

function DocumentPanel({
  projectId,
  docMeta,
  evidenceItems,
  newUpload,
  onUploadComplete,
  onGenerate,
}: {
  projectId: string;
  docMeta: DocMeta[];
  evidenceItems: EvidenceItem[];
  newUpload: boolean;
  onUploadComplete: (results: UploadResult[]) => void;
  onGenerate: () => void;
}) {
  const groupedDocs = groupDocuments(docMeta);
  const missingMaterials = materialSuggestions(docMeta);

  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">项目材料</h2>
          <p className="mt-1 text-xs text-ink-faint">
            按材料类型整理上传内容，方便判断哪些证据已经到位。
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft">
          {docMeta.length} 份材料
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {evidenceItems.slice(0, 4).map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-line bg-[#fffdfa] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  item.done ? "bg-accent" : "bg-[#d79b35]"
                }`}
              />
              <span className="text-xs font-medium text-ink">{item.label}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-soft">{item.note}</p>
          </div>
        ))}
      </div>

      {missingMaterials.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#ead7b8] bg-[#fff8e8] px-3 py-2">
          <p className="text-xs font-medium text-[#7c521b]">建议补充</p>
          <p className="mt-1 text-xs leading-5 text-[#8a5b1f]">
            {missingMaterials.join("、")}
          </p>
        </div>
      )}

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
        <div className="mt-5 space-y-4">
          {groupedDocs.map((group) => (
            <section key={group.kind}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium text-ink-soft">{group.label}</h3>
                <span className="text-xs text-ink-faint">{group.docs.length} 份</span>
              </div>
              <ul className="space-y-2">
                {group.docs.map((d) => (
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
            </section>
          ))}
        </div>
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
