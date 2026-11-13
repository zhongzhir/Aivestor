"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WORK_INTENTS,
  buildWorkIntentHref,
  classifyWorkIntent,
  type WorkIntentId,
  workIntentDefinition,
} from "@/lib/workIntent";

export function UnifiedTaskLauncher() {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [selectedIntent, setSelectedIntent] = useState<WorkIntentId | null>(null);
  const inferredIntent = useMemo(() => classifyWorkIntent(brief), [brief]);
  const activeIntent = selectedIntent ?? inferredIntent;
  const active = workIntentDefinition(activeIntent);

  function submit() {
    if (!brief.trim()) return;
    router.push(buildWorkIntentHref(activeIntent, brief));
  }

  return (
    <div className="rounded-2xl border border-[#ded5c8] bg-white p-3 shadow-[0_10px_30px_rgba(55,53,47,0.08)] sm:p-4">
      <label htmlFor="unified-task-brief" className="sr-only">
        用一句话说明要完成的投资工作
      </label>
      <textarea
        id="unified-task-brief"
        value={brief}
        onChange={(event) => {
          setBrief(event.target.value);
          setSelectedIntent(null);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
        }}
        rows={3}
        maxLength={2_000}
        placeholder="例如：分析云合智能 BP，重点核验技术、订单和收入预测"
        className="min-h-[96px] w-full resize-none rounded-xl border-0 bg-[#fbfaf7] px-4 py-3 text-base leading-7 text-ink outline-none ring-1 ring-inset ring-line placeholder:text-ink-faint focus:ring-2 focus:ring-accent/25"
      />

      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1" aria-label="任务类型">
        {WORK_INTENTS.map((intent) => (
          <button
            key={intent.id}
            type="button"
            aria-pressed={activeIntent === intent.id}
            onClick={() => setSelectedIntent(intent.id)}
            className={`min-h-11 shrink-0 snap-start rounded-full border px-3 text-xs font-medium transition-colors ${
              activeIntent === intent.id
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-white text-ink-soft hover:border-[#b7c8bc] hover:text-ink"
            }`}
          >
            {intent.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-ink-soft" aria-live="polite">
          将进入：<span className="font-medium text-ink">{active.label}</span>
          <span className="hidden sm:inline"> · {active.helper}</span>
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!brief.trim()}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          带着任务继续 →
        </button>
      </div>
    </div>
  );
}
