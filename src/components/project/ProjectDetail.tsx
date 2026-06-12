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
import { FileUploader, type UploadResult } from "@/components/shared/FileUploader";
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

// 每张图片预估 token（与后端 ESTIMATED_TOKENS_PER_IMAGE 保持一致，用于额度提示）
const EST_TOKENS_PER_IMAGE = 600;
// 每张图片预估识别耗时约 30 秒，向上取整到分钟，最少 1 分钟
function estimateMinutes(imageCount: number): number {
  return Math.max(1, Math.ceil(imageCount / 2));
}

// 单个文档的图片识别状态（按需查询 / 触发）
interface ImgState {
  loading: boolean; // 状态查询中
  supported: boolean; // 可做图片识别（bp + 支持格式 + 系统已配置）
  imageCount: number; // 嵌入图片数（已识别则为已识别张数）
  analyzed: boolean; // 已识别过
  analyzing: boolean; // 正在识别
  note: string; // 完成后摘要
  error: string;
}

const FILE_TYPE_ICON: Record<string, string> = {
  pdf: "📕",
  docx: "📘",
  pptx: "📙",
  xlsx: "📗",
  xls: "📗",
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

  // SKILL 分析弹窗
  const [showSkillModal, setShowSkillModal] = useState(false);
  // 是否存在已解析完成的文档（决定「SKILL 分析」是否可用）
  const hasParsedDoc = docMeta.some((d) => d.parseStatus === "done");

  // 新文件上传完成提示
  const [newUpload, setNewUpload] = useState(false);

  function handleUploadComplete(results: UploadResult[]) {
    if (results.some((r) => r.status === "done")) {
      setNewUpload(true);
      router.refresh();
    }
  }

  // 个人项目转入组织（不可逆，二次确认）
  const [transferring, setTransferring] = useState(false);
  async function handleTransferToOrg() {
    if (
      !window.confirm(
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

  // —— BP 图片识别（项目页按需触发）——
  // 每个 BP 文档的图片识别状态；剩余免费额度（用于额度不足提示）
  const [imgStates, setImgStates] = useState<Record<string, ImgState>>({});
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  // 挂载 / SSR 数据变化时，对已解析的 BP 文档异步查询图片状态（不阻塞首屏）
  useEffect(() => {
    const bpDocs = docMeta.filter(
      (d) => d.docKind === "bp" && d.parseStatus === "done"
    );
    if (bpDocs.length === 0) return;

    // 额度状态（一次性，余额不足在按钮区提示）
    fetch("/api/user/quota-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => {
        if (q?.enabled) setQuotaRemaining(q.tokensRemaining ?? null);
      })
      .catch(() => {});

    // 逐个查询图片状态。已在识别中 / 已完成的本地态不覆盖，避免 refresh 打断。
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
            // 识别中 / 已出摘要的不覆盖
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

  // 用户点击「提取图片信息」：调用 Qwen-VL 识别（后台进行，不阻塞页面其他操作）
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
      if (data.skipped > 0) parts.push(`另有 ${data.skipped} 张未处理`);
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

  // 判断要点行：沿用已保存的，否则给 3 个空行
  const [points, setPoints] = useState<string[]>(
    initialPoints.length > 0 ? initialPoints : ["", "", ""]
  );
  const [error, setError] = useState("");

  // 财务数据
  const [financials, setFinancials] = useState<FinancialData | null>(
    initialFinancialData
  );
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState("");

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
      setError("请输入 3–10 条判断要点");
      return;
    }
    setError("");
    stashJudgmentPoints(projectId, filled);
    router.push(`/projects/${projectId}/report?generate=1`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{projectName}</h1>
            {outcome && outcome !== "pending" && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  outcomeDef(outcome).badgeClass
                }`}
              >
                {outcomeDef(outcome).icon} {outcomeDef(outcome).label}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            填写判断要点并生成分析报告
          </p>
        </div>
        {latestReportId && (
          <Link
            href={`/projects/${projectId}/report`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-surface"
          >
            查看已有报告
          </Link>
        )}
      </div>

      <div className="mt-6">
        <StageProgress
          projectId={projectId}
          initialStage={processStage}
          initialJudgments={judgments}
          initialOutcome={outcome}
          initialOutcomeNote={outcomeNote}
        />
      </div>

      {/* Tab 切换 */}
      <div className="mt-8 flex gap-1 border-b border-line">
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
          <DecisionTools
            projectId={projectId}
            processStage={processStage}
          />
        </div>
      )}

      {tab === "post" && <PostInvestment projectId={projectId} />}

      {tab === "analysis" && (
      <>
      {/* 组织协作：转入入口 / 多人判断 / 评论（仅相关时渲染） */}
      {!isOrgProject && hasOrg && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-ink-soft">
            将本项目转为组织项目，团队成员可协作查看与评论。
          </p>
          <button
            onClick={handleTransferToOrg}
            disabled={transferring}
            className="shrink-0 text-xs font-medium text-accent hover:underline disabled:opacity-50"
          >
            {transferring ? "转入中…" : "转为组织项目 →"}
          </button>
        </div>
      )}

      {isOrgProject && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              团队判断
            </h2>
            <JudgmentsByMember projectId={projectId} />
          </div>
          <div className="space-y-6 rounded-lg border border-line bg-surface p-4">
            <ShareControl projectId={projectId} />
            <CommentPanel projectId={projectId} currentUserId={currentUserId} />
          </div>
        </div>
      )}

      {/* 项目文档：多文件上传 */}
      <div className="mt-6 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          项目文档
        </h2>
        <div className="mt-3">
          <FileUploader
            target="project"
            projectId={projectId}
            onUploadComplete={handleUploadComplete}
          />
        </div>

        {newUpload && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-accent-soft px-3 py-2 text-xs text-accent">
            <span>新文件已解析完成。</span>
            <button
              onClick={handleGenerate}
              className="shrink-0 font-medium hover:underline"
            >
              重新生成分析报告 →
            </button>
          </div>
        )}

        {docMeta.length > 0 && (
          <ul className="mt-3 space-y-1">
            {docMeta.map((d, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-xs text-ink-soft"
              >
                <span>{FILE_TYPE_ICON[d.fileType] ?? "📄"}</span>
                <span className="flex-1 truncate text-ink">{d.filename}</span>
                <span className="text-ink-faint">
                  {new Date(d.uploadedAt).toLocaleDateString("zh-CN")}
                </span>
                <span
                  className={
                    d.parseStatus === "done" ? "text-accent" : "text-ink-faint"
                  }
                >
                  {d.parseStatus === "done" ? "已解析" : d.parseStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* 左：BP 文本 */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            BP 提取文本
          </h2>
          <p className="mt-2 text-xs text-ink-faint">
            {docMeta.length > 0
              ? docMeta
                  .map((d) => `${d.filename}（${d.chars.toLocaleString()} 字）`)
                  .join("、")
              : "尚未上传文档"}
          </p>

          {/* BP 图片识别：项目页按需触发，不阻塞其他操作 */}
          {docMeta
            .filter((d) => d.docKind === "bp")
            .map((d) => {
              const st = imgStates[d.id];
              // 状态未知 / 查询中 / 不支持 → 不显示按钮
              if (!st || st.loading || !st.supported) return null;
              // 既未识别又无图片 → 不显示
              if (!st.analyzed && st.imageCount === 0) return null;
              const insufficient =
                !st.analyzed &&
                quotaRemaining !== null &&
                quotaRemaining < st.imageCount * EST_TOKENS_PER_IMAGE;
              return (
                <div key={d.id} className="mt-2 text-xs">
                  {st.analyzed ? (
                    <p className="text-accent">
                      ✓ 已提取图片信息
                      {st.note ? `（${st.note}）` : ""}
                    </p>
                  ) : (
                    <>
                      <button
                        onClick={() => analyzeImages(d.id)}
                        disabled={st.analyzing}
                        className="rounded-md border border-accent px-3 py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
                      >
                        {st.analyzing
                          ? "识别中…（可继续其他操作）"
                          : `提取图片信息（${st.imageCount}张，约${estimateMinutes(
                              st.imageCount
                            )}分钟）`}
                      </button>
                      {insufficient && (
                        <p className="mt-1 text-amber-600">
                          ⚠️ 当前剩余额度可能不足以完成图片识别，建议配置自己的 API Key
                        </p>
                      )}
                      {st.error && (
                        <p className="mt-1 text-red-600">{st.error}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}

          <div className="mt-2 h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-xs leading-6 text-ink-soft">
            {bpText || "（无可显示的文本）"}
          </div>
        </section>

        {/* 右：判断要点 + API Key */}
        <section className="space-y-6">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              判断要点（3–10 条）
            </h2>
            <div className="mt-3 space-y-2">
              {points.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-ink-faint">
                    {i + 1}
                  </span>
                  <input
                    value={p}
                    onChange={(e) => updatePoint(i, e.target.value)}
                    placeholder="一条你对该项目的核心判断"
                    className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
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
                className="mt-2 text-xs font-medium text-accent hover:underline"
              >
                + 添加一条
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGenerate}
              className="flex-1 min-w-[140px] rounded-md bg-accent py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              生成分析报告
            </button>
            <Link
              href={`/projects/${projectId}/brief-analysis`}
              title="无需 3 条判断，快速入库的原则性评估"
              className="rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface"
            >
              简要分析
            </Link>
            <Link
              href={`/projects/${projectId}/term-sheet`}
              title="基于项目信息生成投资条款清单初稿"
              className="rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface"
            >
              📋 Term Sheet 初稿
            </Link>
            <button
              onClick={() => setShowSkillModal(true)}
              disabled={!hasParsedDoc}
              title={
                hasParsedDoc ? undefined : "请先上传并解析项目文档"
              }
              className="rounded-md border border-accent px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint disabled:hover:bg-transparent"
            >
              SKILL 分析
            </button>
            <button
              onClick={handleExtractFinancials}
              disabled={finLoading}
              className="rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
            >
              {finLoading ? "提取中…" : "提取财务数据"}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            还没填判断？试试 <Link href={`/projects/${projectId}/brief-analysis`} className="text-accent hover:underline">简要分析</Link>，先做一份原则性评估存档。
          </p>
        </section>
      </div>

      {/* 财务数据图表预览 */}
      {(finLoading || finError || financials) && (
        <div className="mt-10 border-t border-line pt-6">
          <h2 className="mb-3 text-sm font-medium text-ink">财务数据</h2>
          {finLoading ? (
            <p className="py-8 text-center text-sm text-ink-faint">
              AI 正在提取财务数据…
            </p>
          ) : finError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {finError}
            </p>
          ) : financials ? (
            <FinancialCharts data={financials} />
          ) : null}
        </div>
      )}
      </>
      )}

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
