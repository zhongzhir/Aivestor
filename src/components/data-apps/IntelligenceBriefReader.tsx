"use client";

import { useEffect, useMemo, useState } from "react";
import { safeIntelligenceExternalUrl } from "@/lib/intelligenceUrl";
import { intelligenceEventTimeLabel, type IntelligenceBrief, type IntelligenceBriefItem } from "./intelligenceTypes";

const TIER: Record<string, string> = { S: "官方", A: "专业", B: "媒体", C: "门户", D: "内部" };

function date(value?: string | null) {
  if (!value) return "未确认";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("zh-CN") : "未确认";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueSources(brief: IntelligenceBrief) {
  const seen = new Set<string>();
  return brief.source_list.filter((source) => {
    const key = source.url || `${source.source}-${source.publishedAt}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function IntelligenceBriefReader({ brief }: { brief: IntelligenceBrief }) {
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [feedbackNote, setFeedbackNote] = useState(false);
  const metadata = asObject(brief.metadata);
  const retrieval = asObject(metadata.retrieval);
  const research = asObject(metadata.research);
  const validation = asObject(research.validation);
  const rejectedItems = Math.max(0, Number(validation.rejectedItems || 0));
  const acceptedItems = Math.max(0, Number(validation.acceptedItems || 0));
  const overview = typeof metadata.overview === "string" ? metadata.overview.replace(/^#{1,3}\s+/, "").trim() : "";
  const facts = useMemo(() => [...(brief.important_facts || [])], [brief.important_facts]);
  const clues = useMemo(() => [...(brief.other_items || [])].filter((item) => item.isClue), [brief.other_items]);
  const other = useMemo(() => [...(brief.trend_signals || []), ...(brief.other_items || []).filter((item) => !item.isClue)], [brief.trend_signals, brief.other_items]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/data-apps/intelligence-subscriptions/briefs/${brief.id}/feedback`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        if (!alive) return;
        const restored: Record<string, string> = {};
        for (const entry of data.feedback ?? []) if (entry.item_key && entry.feedback) restored[entry.item_key] = entry.feedback;
        setFeedback(restored);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [brief.id]);

  async function mark(itemKey: string, value: "valuable" | "irrelevant") {
    const response = await fetch(`/api/data-apps/intelligence-subscriptions/briefs/${brief.id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemKey, feedback: value }),
    });
    if (!response.ok) return;
    setFeedback((current) => ({ ...current, [itemKey]: value }));
    setFeedbackNote(true);
  }

  const retrievalStatus = retrieval.status;
  const providers = Array.isArray(retrieval.providers) ? retrieval.providers.map(asObject) : [];
  const retrievalSources = Array.isArray(retrieval.sources) ? retrieval.sources.map(asObject) : [];
  const sourceEvidenceStatus = new Map(
    retrievalSources.flatMap((source) => typeof source.url === "string" && typeof source.evidenceStatus === "string"
      ? [[source.url, source.evidenceStatus] as const]
      : []),
  );
  const evidenceCounts = asObject(retrieval.evidence);
  const countedVerifiedSources = Math.max(0, Number(evidenceCounts.full || 0)) + Math.max(0, Number(evidenceCounts.partial || 0));
  const verifiedSourceCount = countedVerifiedSources || retrievalSources.filter((source) => source.evidenceStatus === "full" || source.evidenceStatus === "partial").length;
  const limitedDateCoverage = providers.some((provider) => provider.coverageCapability === "coarse" || provider.coverageCapability === "unsupported");
  const sourceSet = uniqueSources(brief);
  return (
    <div className="space-y-5">
      {retrievalStatus === "partial" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          本期部分完成：部分来源不可达。以下内容只代表本次实际检索到的来源集合，不表示市场中没有其他事件。
        </div>
      ) : retrievalStatus === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          本期检索未完成，没有形成覆盖结论。旧成功简报不会被覆盖。
        </div>
      ) : null}
      {rejectedItems > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          模型返回的 {rejectedItems} 条事项未通过逐项结构或证据校验，已隔离；本期仅展示 {acceptedItems} 条通过校验的事项，来源记录仍保留。
        </div>
      ) : null}
      {limitedDateCoverage ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          部分检索来源只支持粗粒度日期或不支持精确日期过滤；系统会在结果阶段按事件日期复核，但不能据此声称时间窗内全量召回。
        </div>
      ) : null}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">本期结论</p>
            <p className="mt-1 text-sm text-ink-faint">覆盖 {date(brief.coverage_start)} 至 {date(brief.coverage_end)} · 生成于 {new Date(brief.generated_at).toLocaleString("zh-CN")}</p>
          </div>
          <span className="text-xs text-ink-faint">
            {brief.item_count} 条事件 · {sourceSet.length} 个检索候选{verifiedSourceCount > 0 ? ` · ${verifiedSourceCount} 个已取证` : ""}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-soft">
          {overview || (brief.item_count === 0 ? "本期没有达到发布标准的新事件。这不代表市场中不存在其他事件。" : "本期成果已生成，请查看重点事件。")}
        </p>
      </section>

      <EventSection title="重点事件" items={facts} feedback={feedback} onFeedback={mark} />
      {clues.length > 0 && <EventSection title="待核实线索" items={clues} feedback={feedback} onFeedback={mark} subdued />}
      {other.length > 0 && (
        <details className="rounded-lg border border-line bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">其他事件与趋势（{other.length}）</summary>
          <div className="mt-4"><EventSection title="" items={other} feedback={feedback} onFeedback={mark} /></div>
        </details>
      )}

      <details className="rounded-lg border border-line bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">查看本期检索来源（{sourceSet.length}）</summary>
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {sourceSet.length === 0 ? <p className="text-sm text-ink-faint">本期没有可展示的来源记录。</p> : sourceSet.map((source, index) => (
            <div key={`${source.url ?? source.source}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
              <span>
                {source.source || "来源"}
                {source.sourceTier ? ` · ${TIER[source.sourceTier] ?? source.sourceTier}` : ""}
                {source.publishedAt ? ` · 发布于 ${date(source.publishedAt)}` : ""}
                {source.url ? ` · ${evidenceLabel(sourceEvidenceStatus.get(source.url))}` : ""}
              </span>
              {safeIntelligenceExternalUrl(source.url) ? <a href={safeIntelligenceExternalUrl(source.url)!} target="_blank" rel="noreferrer" className="text-accent hover:underline">原文</a> : <span>无安全原文链接</span>}
            </div>
          ))}
        </div>
      </details>

      {feedbackNote && <p role="status" className="text-xs text-ink-faint">反馈已记录；当前不会改变排序或后续生成。</p>}
    </div>
  );
}

function evidenceLabel(status?: string) {
  if (status === "full") return "全文核验";
  if (status === "partial") return "部分核验";
  if (status === "not_selected") return "未进入取证队列";
  if (status === "unavailable") return "正文未取到";
  return "取证状态未知";
}

function EventSection({ title, items, feedback, onFeedback, subdued = false }: {
  title: string;
  items: IntelligenceBriefItem[];
  feedback: Record<string, string>;
  onFeedback: (itemKey: string, value: "valuable" | "irrelevant") => void;
  subdued?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      {title && <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>}
      <div className="space-y-3">
        {items.map((item, index) => <EventCard key={item.id || `${item.title}-${index}`} item={item} feedback={feedback[item.id]} onFeedback={onFeedback} subdued={subdued} />)}
      </div>
    </section>
  );
}

function EventCard({ item, feedback, onFeedback, subdued }: {
  item: IntelligenceBriefItem;
  feedback?: string;
  onFeedback: (itemKey: string, value: "valuable" | "irrelevant") => void;
  subdued: boolean;
}) {
  const urls = [...new Set([item.sourceUrl, ...(item.sourceUrls ?? [])].map(safeIntelligenceExternalUrl).filter((value): value is string => !!value))];
  // Event-time precision and source publication time are independent facts.
  // A source can have a verified publication timestamp even when the event is
  // only known as (for example) "2024 年春节前".
  const published = item.publishedAt ? `发布日 ${date(item.publishedAt)}` : "发布时间未确认";
  return (
    <article className={`rounded-lg border p-4 ${subdued ? "border-amber-100 bg-amber-50/30" : "border-line bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="max-w-3xl text-sm font-medium leading-6 text-ink">{item.title || "相关事件"}</h4>
        <div className="flex gap-1.5 text-[11px]">
          {item.eventType && <span className="rounded bg-surface px-2 py-1 text-ink-soft">{item.eventType}</span>}
          {item.isClue ? <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">线索</span> : <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">事实</span>}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{item.summary || item.content || "暂无事实摘要"}</p>
      {item.investmentNote && <p className="mt-3 rounded-md bg-[#f7f8fa] px-3 py-2 text-sm leading-6 text-ink"><span className="font-medium">投资研判（推断）：</span>{item.investmentNote}</p>}
      {item.isClue && <p className="mt-2 text-xs leading-5 text-amber-800">还需确认：{item.followUpReason || "需要更直接的来源或事件日期。"}</p>}
      {item.conflicts?.map((conflict) => <p key={`${conflict.type}-${conflict.values.join("-")}`} className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">可能存在融资轮次口径差异：同一主体在相近日期出现不同轮次（{conflict.values.join(" / ")}）。请核对这些来源是否指向同一事项，并以公司公告或监管披露为准。</p>)}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-faint">
        <span>{intelligenceEventTimeLabel(item)} · {published}{item.discoveredAt ? ` · 发现日 ${date(item.discoveredAt)}` : ""}{item.evidenceStatus ? ` · ${item.evidenceStatus === "full" ? "全文核验" : item.evidenceStatus === "partial" ? "部分核验" : "仅摘要"}` : ""}</span>
        <span className="flex gap-3">
          {urls[0] && <a href={urls[0]} target="_blank" rel="noreferrer" className="text-accent hover:underline">查看证据</a>}
          <button type="button" onClick={() => onFeedback(item.id, "valuable")} className={feedback === "valuable" ? "font-medium text-accent" : "hover:text-ink"}>有价值</button>
          <button type="button" onClick={() => onFeedback(item.id, "irrelevant")} className={feedback === "irrelevant" ? "font-medium text-red-700" : "hover:text-ink"}>无关</button>
        </span>
      </div>
    </article>
  );
}
