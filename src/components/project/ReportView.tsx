"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  popReportGeneration,
  readTextStream,
  readError,
} from "@/lib/clientAI";
import { FinancialCharts } from "./FinancialCharts";
import { DigestCard } from "@/components/report/DigestCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { renderSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import { ConfidencePanel } from "@/components/report/ConfidencePanel";
import { ExportDownloadButton } from "@/components/shared/ExportDownloadButton";
import type { FinancialData } from "@/lib/types";
import { ResultNextActions } from "@/components/shared/ResultNextActions";
import {
  assessDeepResearchReport,
  type DeepResearchGate,
  type DeepResearchMetadata,
} from "@/lib/deepResearchWorkpaper";
import type { ResolvedDeepResearchProfile } from "@/lib/deepResearch";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 在默认 sanitize 规则基础上放行溯源徽章用到的 <span class="src-badge ...">，
// 既消毒报告中可能注入的恶意 HTML，又保留徽章样式。
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
};

interface HistoryItem {
  instruction: string;
  ts: string;
}

interface Props {
  projectId: string;
  projectName: string;
  initialReportId: string | null;
  initialReportTitle?: string | null;
  initialReportKind?: string | null;
  initialContent: string;
  initialHistory: HistoryItem[];
  initialFinancialData: FinancialData | null;
  initialResearchMetadata: DeepResearchMetadata | null;
  autoGenerate: boolean;
}

type Mode = "idle" | "generating" | "refining";

export function ReportView({
  projectId,
  projectName,
  initialReportId,
  initialReportTitle,
  initialReportKind,
  initialContent,
  initialHistory,
  initialFinancialData,
  initialResearchMetadata,
  autoGenerate,
}: Props) {
  const router = useRouter();

  const [content, setContent] = useState(initialContent);
  const [reportId, setReportId] = useState(initialReportId);
  const [reportTitle, setReportTitle] = useState(
    initialReportTitle || `${projectName} · 项目分析报告`
  );
  const [reportKind, setReportKind] = useState(initialReportKind || "analysis");
  const [researchProfile, setResearchProfile] = useState<ResolvedDeepResearchProfile | null>(
    initialResearchMetadata?.profile ?? null
  );
  const [researchMetadata, setResearchMetadata] = useState<DeepResearchMetadata | null>(
    initialResearchMetadata
  );
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [mode, setMode] = useState<Mode>("idle");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");

  // 财务分析面板
  const [showFinancials, setShowFinancials] = useState(false);
  const [financials, setFinancials] = useState<FinancialData | null>(
    initialFinancialData
  );
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState("");

  const startedRef = useRef(false);
  const streaming = mode !== "idle";

  async function toggleFinancials() {
    if (showFinancials) {
      setShowFinancials(false);
      return;
    }
    setShowFinancials(true);
    if (financials || finLoading) return;
    setFinError("");
    setFinLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/financials`, {
        method: "POST",
        headers: JSON_HEADERS,
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

  async function generate() {
    const request = popReportGeneration(projectId);
    if (!request) {
      setError("未找到本轮生成任务，请回到项目页重新发起");
      return;
    }
    if (request.mode === "standard" && request.judgmentPoints.length < 3) {
      setError("标准分析报告需要 3-10 条判断要点，请回到项目页补充");
      return;
    }
    setError("");
    setMode("generating");
    setContent("");
    setResearchMetadata(null);
    setReportKind(request.mode === "deep_research" ? "deep_research" : "analysis");
    setReportTitle(
      request.mode === "deep_research"
        ? `${projectName} · 深度投研报告`
        : `${projectName} · 项目分析报告`
    );
    try {
      const res = await fetch(`/api/projects/${projectId}/reports`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "生成失败"));
      }
      const rid = res.headers.get("X-Report-Id");
      if (rid) setReportId(rid);
      const kind = res.headers.get("X-Report-Kind");
      if (kind) setReportKind(kind);
      const profile = res.headers.get("X-Research-Profile");
      if (profile === "early_stage" || profile === "comprehensive") {
        setResearchProfile(profile);
      }
      await readTextStream(res, (t) => setContent((c) => c + t));
      if (rid && request.mode === "deep_research") {
        await refreshResearchMetadata(rid);
      }
    } catch (e) {
      setContent("");
      setReportId(null);
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setMode("idle");
      // 清除 URL 上的 generate 参数，避免刷新重复生成
      router.replace(`/projects/${projectId}/report`);
    }
  }

  async function refine() {
    const text = instruction.trim();
    if (!text || !reportId) return;
    setError("");
    setMode("refining");
    setContent("");
    try {
      const res = await fetch(`/api/reports/${reportId}/refine`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ instruction: text }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "修改失败"));
      }
      await readTextStream(res, (t) => setContent((c) => c + t));
      if (reportKind === "deep_research") {
        await refreshResearchMetadata(reportId);
      }
      setHistory((h) => [...h, { instruction: text, ts: new Date().toISOString() }]);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setMode("idle");
    }
  }

  async function refreshResearchMetadata(id: string) {
    try {
      const response = await fetch(`/api/reports/${id}/quality`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { researchMetadata?: DeepResearchMetadata };
      if (data.researchMetadata?.profile) {
        setResearchMetadata(data.researchMetadata);
        setResearchProfile(data.researchMetadata.profile);
      }
    } catch {
      // 正文已经保存；门禁元数据读取失败时仍可用本地解析结果展示。
    }
  }

  useEffect(() => {
    if (autoGenerate && !startedRef.current) {
      startedRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      {/* 顶部：标题 + 导出 */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">
            {reportTitle}
          </h1>
          <p className="mt-0.5 text-xs text-ink-faint">
            {streaming
              ? mode === "generating"
                ? reportKind === "deep_research"
                  ? "正在按深度投研框架生成…"
                  : "正在生成…"
                : "正在修改…"
              : `共 ${history.length} 轮修改`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFinancials}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              showFinancials
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-ink-soft hover:bg-surface"
            }`}
          >
            财务分析
          </button>
          <ExportDownloadButton
            href={`/api/reports/${reportId ?? ""}/export`}
            label="导出 Word"
            disabled={!reportId || streaming}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              reportId && !streaming
                ? "border-line text-ink-soft hover:bg-surface"
                : "border-line text-ink-faint"
            }`}
          />
          <ExportDownloadButton
            href={`/api/reports/${reportId ?? ""}/export?formal=1`}
            label="正式版 Word"
            disabled={!reportId || streaming}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              reportId && !streaming
                ? "border-accent bg-accent-soft text-accent hover:bg-[#f3e5dc]"
                : "border-line text-ink-faint"
            }`}
          />
          <ExportDownloadButton
            href={`/api/reports/${reportId ?? ""}/export-ppt`}
            label="导出 PPT"
            disabled={!reportId || streaming}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              reportId && !streaming
                ? "border-accent text-accent hover:bg-accent-soft"
                : "border-line text-ink-faint"
            }`}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 财务分析面板（可展开/收起） */}
      {showFinancials && (
        <div className="mt-5 rounded-lg bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink">财务分析</h2>
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

      {/* 报告正文：先剥离置信度块，再渲染溯源徽章 */}
      {(() => {
        if (!content) {
          return (
            <article className="report-body mt-6 min-h-[200px]">
              {streaming ? (
                <p className="text-sm text-ink-faint">等待 AI 输出…</p>
              ) : (
                <EmptyState
                  icon="📄"
                  title="还没有报告"
                  description="上传文档后生成第一份分析报告"
                />
              )}
            </article>
          );
        }
        // 流式过程中保留原始内容（标记尚未完整，extractConfidence 会返回原文）
        const workpaper = reportKind === "deep_research" && researchProfile
          ? assessDeepResearchReport({ content, profile: researchProfile })
          : null;
        const { confidence, cleanContent } = extractConfidence(
          workpaper?.cleanContent ?? content
        );
        const rendered = renderSourceBadges(cleanContent);
        return (
          <>
            <article className="report-body mt-6 min-h-[200px]">
              <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}>{rendered}</ReactMarkdown>
              {streaming && <span className="type-cursor" />}
            </article>
            {confidence && !streaming && <ConfidencePanel data={confidence} />}
            {workpaper && !streaming && (
              <DeepResearchGatePanel
                gate={researchMetadata?.gate ?? workpaper.gate}
                ledger={researchMetadata?.evidenceLedger ?? workpaper.ledger}
              />
            )}
            {!streaming && <SourceLegend />}
          </>
        );
      })()}

      {reportId && content && !streaming && (
        <div className="mt-6">
          <ResultNextActions
            title={
              reportKind === "deep_research"
                ? "深度投研底稿已进入项目档案"
                : "报告完成后继续推进项目"
            }
            description={
              reportKind === "deep_research"
                ? "优先处理报告中的 P0 缺口和反方证据，再进入投资决策或正式导出。"
                : "报告已保存在项目中，可以直接进入决策讨论或回到项目维护下一步。"
            }
            actions={[
              { label: "返回项目", href: `/projects/${projectId}`, primary: true },
              { label: "进入 IC", href: `/projects/${projectId}?tab=decision&focus=ic` },
              { label: "维护下一步", href: `/projects/${projectId}?focus=next-action` },
              { label: "查看项目档案", href: `/archive/${projectId}` },
            ]}
          />
        </div>
      )}

      {/* 修改历史 */}
      {history.length > 0 && (
        <div className="mt-10 border-t border-line pt-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            修改历史
          </h2>
          <ol className="mt-3 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink-soft">
                <span className="text-ink-faint">第 {i + 1} 轮</span>
                <span className="flex-1">{h.instruction}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 对话沉淀入口：对话轮次 ≥ 3 且有报告时显示 */}
      {reportId && history.length >= 3 && !streaming && (
        <DigestCard
          reportId={reportId}
          projectId={projectId}
          projectName={projectName}
          conversationLength={history.length}
        />
      )}

      {/* 修改指令输入 */}
      <div className="mt-8 border-t border-line pt-5">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={streaming || !reportId}
          rows={2}
          placeholder="告诉 AI 如何修改这份报告…"
          className="w-full resize-none rounded-md border border-line px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent disabled:bg-surface"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={refine}
            disabled={streaming || !reportId || !instruction.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            提交修改
          </button>
        </div>
      </div>
    </div>
  );
}

function DeepResearchGatePanel({
  gate,
  ledger,
}: {
  gate: DeepResearchGate;
  ledger: DeepResearchMetadata["evidenceLedger"];
}) {
  const style = gate.status === "pass"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : gate.status === "blocked"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-900";
  const label = gate.status === "pass" ? "已通过" : gate.status === "blocked" ? "未通过" : "需复核";
  return (
    <section className={`mt-6 rounded-lg border p-4 ${style}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">深度投研质量门禁 · {label}</h2>
        <p className="text-xs">
          章节 {gate.coveredSectionCount}/{gate.requiredSectionCount} · 证据主张 {gate.evidenceItemCount} · 定位引用 {gate.locatedEvidenceCount}
        </p>
      </div>
      {gate.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {gate.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {ledger.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium">查看结构化证据底稿</summary>
          <div className="mt-2 space-y-2">
            {ledger.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded border border-current/20 bg-white/60 p-2">
                <p className="font-medium">{item.id} · {item.priority} · {item.claim}</p>
                <p className="mt-1 opacity-80">
                  状态：{item.status}；定位：{item.citations.join("、") || "无"}
                </p>
                {item.verificationAction && <p className="mt-1">验证动作：{item.verificationAction}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// 报告溯源图例：解释正文中三种徽章的含义
function SourceLegend() {
  return (
    <div className="mt-6 rounded-lg border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">标注说明</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-doc">📄 文件依据</span>
          基于上传文件中的明确信息
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-data">✅ 数据提取</span>
          已从文件中提取的量化数据
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-ai">🤖 AI 推断</span>
          基于行业经验的判断，建议核实
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-external">🔗 外部证据</span>
          具有可追踪出处的外部或机构资料
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-gap">待补</span>
          当前材料无法支持，进入补充尽调
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="src-badge src-inconsistent">冲突</span>
          材料数字或口径存在矛盾
        </span>
      </div>
    </div>
  );
}
