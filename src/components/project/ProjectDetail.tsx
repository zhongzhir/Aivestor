"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FinancialCharts } from "./FinancialCharts";
import { StageProgress, type Judgment } from "./StageProgress";
import { DecisionTools } from "./DecisionTools";
import { PostInvestment } from "./PostInvestment";
import { FileUploader, type UploadResult } from "@/components/shared/FileUploader";
import { SkillRunModal } from "@/components/skills/SkillRunModal";
import { stashJudgmentPoints, readError } from "@/lib/clientAI";
import { outcomeDef } from "@/lib/outcome";
import type { FinancialData } from "@/lib/types";

type Tab = "analysis" | "decision" | "post";

export interface DocMeta {
  filename: string;
  chars: number;
  fileType: string;
  parseStatus: string;
  uploadedAt: string;
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

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              className="flex-1 rounded-md bg-accent py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              生成分析报告
            </button>
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
