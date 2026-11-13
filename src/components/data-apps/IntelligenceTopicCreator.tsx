"use client";

import { useRef, useState } from "react";

interface DraftTask {
  name: string;
  topics: string[];
  entities: string[];
  keywords: string[];
  regions: string[];
  includeRequirements: string[];
  excludeRequirements: string[];
  maxItems: number;
  lookbackPeriod: { kind: "days" | "custom"; value?: number; start?: string; end?: string };
  outputInstructions: string;
  executionMode: "manual" | "scheduled";
  scheduleConfig: { frequency: "daily" | "weekly"; weekdays?: number[]; time: string; timezone: string } | null;
  isActive: boolean;
}

interface DraftResponse {
  plan: { task: DraftTask; questions: string[] };
  parseMetadata?: { method?: string; parsedAt?: string; currentDate?: string; warnings?: string[] };
}

function calendar(value?: string) {
  if (!value) return "未设置";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN") : "未设置";
}

function inferEventTypes(task: DraftTask): string[] {
  const text = [...task.keywords, ...task.includeRequirements, task.outputInstructions].join(" ");
  const pairs: Array<[RegExp, string]> = [
    [/融资|投资|募资|增资|轮次/, "融资"],
    [/并购|收购/, "并购"],
    [/经营|订单|收入|业务/, "经营"],
    [/监管|政策|处罚|审批/, "监管"],
    [/人事|任命|离职|高管/, "人事"],
  ];
  const types = pairs.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return types.length > 0 ? types : ["重要动态"];
}

function scheduleLabel(task: DraftTask) {
  const schedule = task.scheduleConfig;
  if (task.executionMode !== "scheduled" || !schedule) return "无；本次完成后结束";
  const day = schedule.frequency === "daily"
    ? "每天"
    : `每周${(schedule.weekdays ?? []).map((value) => ["日", "一", "二", "三", "四", "五", "六"][value] ?? "").join("、")}`;
  return `${day} ${schedule.time} · ${schedule.timezone}`;
}

export function IntelligenceTopicCreator({
  onCancel,
  onCreated,
  initialDescription = "",
}: {
  onCancel: () => void;
  onCreated: (topicId: string) => void;
  initialDescription?: string;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submittedDescription = useRef("");
  const createRequestKey = useRef("");

  function ensureCreateRequestKey(value: string) {
    if (createRequestKey.current) return createRequestKey.current;
    const storageKey = "intelligence:pending-create";
    try {
      const previous = JSON.parse(localStorage.getItem(storageKey) || "null") as { description?: string; key?: string } | null;
      if (previous?.description === value && previous.key) createRequestKey.current = previous.key;
      else {
        createRequestKey.current = crypto.randomUUID();
        localStorage.setItem(storageKey, JSON.stringify({ description: value, key: createRequestKey.current }));
      }
    } catch {
      createRequestKey.current = crypto.randomUUID();
    }
    return createRequestKey.current;
  }

  async function createDraft() {
    if (!description.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
      const response = await fetch("/api/data-apps/intelligence-subscriptions/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: description.trim(), timezone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.plan?.task) throw new Error(data.error || "暂时无法整理这条研究意图");
      submittedDescription.current = description.trim();
      ensureCreateRequestKey(submittedDescription.current);
      setDraft(data as DraftResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法整理这条研究意图");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const eventTypes = inferEventTypes(draft.plan.task);
      const requestKey = ensureCreateRequestKey(submittedDescription.current);
      const response = await fetch("/api/data-apps/intelligence-subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": requestKey },
        body: JSON.stringify({
          ...draft.plan.task,
          originalRequest: submittedDescription.current,
          eventTypes,
          sourcePolicy: { coverageDisclosure: "actual-sources-only" },
          parseMetadata: draft.parseMetadata,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.task?.id) throw new Error(data.error || "保存主题失败");
      const topicId = data.task.id as string;
      const key = `${requestKey}:initial`;
      localStorage.setItem(`intelligence:pending:${topicId}`, key);
      const runResponse = await fetch(`/api/data-apps/intelligence-subscriptions/${topicId}/generate`, {
        method: "POST",
        headers: { "idempotency-key": key },
      });
      if (!runResponse.ok) {
        const runError = await runResponse.json().catch(() => ({}));
        localStorage.removeItem(`intelligence:pending:${topicId}`);
        throw new Error(runError.error || "主题已保存，但首次运行未创建");
      }
      localStorage.removeItem("intelligence:pending-create");
      onCreated(topicId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存主题失败");
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={onCancel} className="text-sm text-ink-faint hover:text-ink">← 情报工作空间</button>
        <h1 className="mt-6 text-2xl font-semibold text-ink">新建投资情报主题</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">用一句话说明关注对象、事件和时间要求。系统会先整理成草稿，确认前不会保存或运行。</p>
        {initialDescription && (
          <div className="mt-5 rounded-xl border border-[#d9e3dc] bg-[#f7fbf8] px-4 py-3 text-xs leading-5 text-ink-soft">
            已从工作台带入研究意图。你可以继续修改，确认后系统才会保存主题并开始运行。
          </div>
        )}
        <label className="mt-6 block">
          <span className="sr-only">研究意图</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            autoFocus
            placeholder="例如：收集2026年文化行业并购项目"
            className="w-full rounded-xl border border-line bg-white px-4 py-4 text-base leading-7 outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
          />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={createDraft} disabled={busy || !description.trim()} className="min-h-11 w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
            {busy ? "正在整理…" : "整理成主题"}
          </button>
        </div>
      </div>
    );
  }

  const task = draft.plan.task;
  const eventTypes = inferEventTypes(task);
  const range = task.lookbackPeriod.kind === "custom"
    ? `${calendar(task.lookbackPeriod.start)} 至 ${calendar(task.lookbackPeriod.end)}`
    : `每次回溯最近 ${task.lookbackPeriod.value ?? 3} 天`;
  return (
    <div className="mx-auto max-w-3xl">
      <button type="button" onClick={() => setDraft(null)} className="text-sm text-ink-faint hover:text-ink">← 返回修改</button>
      <h1 className="mt-6 text-2xl font-semibold text-ink">请确认系统的理解</h1>
      <p className="mt-2 text-sm text-ink-soft">查询范围与生成计划分开确认；系统不会静默修改日期。</p>
      <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-white px-5">
        <ReviewRow label="主题名称" value={task.name} />
        <ReviewRow label="研究方式" value={task.executionMode === "scheduled" ? "持续监测" : "一次性回溯"} />
        <ReviewRow label="关注对象" value={[...task.topics, ...task.entities, ...task.regions].join("、") || "按原始描述理解"} />
        <ReviewRow label="事件类型" value={eventTypes.join("、")} />
        <ReviewRow label="查询范围" value={range} />
        <ReviewRow label="生成计划" value={scheduleLabel(task)} />
        <ReviewRow label="来源策略" value="官方/监管优先，专业媒体补充" />
      </dl>
      <div className="mt-4 rounded-lg bg-surface px-4 py-3 text-xs leading-5 text-ink-soft">
        系统只报告本次实际检索到的来源集合；未找到后续信息不代表市场中不存在其他事件。
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-ink-soft">返回修改</button>
        <button type="button" onClick={confirm} disabled={busy} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "正在保存…" : "确认并开始"}
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-ink-faint">{label}</dt>
      <dd className="text-sm leading-6 text-ink">{value}</dd>
    </div>
  );
}
