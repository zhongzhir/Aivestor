"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STAGE_LABELS, ALL_STAGES } from "@/lib/stages";

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "待定" },
  { value: "invested", label: "已投" },
  { value: "passed", label: "已Pass" },
  { value: "exited_profit", label: "退出盈利" },
  { value: "exited_loss", label: "退出亏损" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "created_desc", label: "最新创建" },
  { value: "updated_desc", label: "最近更新" },
];

interface Props {
  stageOptions: string[];
}

export function ProjectFilters({ stageOptions }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMount = useRef(true);

  const stage = searchParams.get("stage") ?? "";
  const processStage = searchParams.get("process_stage") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const sort = searchParams.get("sort") ?? "created_desc";

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    router.replace(qs ? `/projects?${qs}` : "/projects");
  }

  // 搜索框防抖（300ms）
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ search });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="mt-6 space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索项目名称或判断要点…"
        className="w-full rounded border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-[#0D1B3E]"
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <select
          value={stage}
          onChange={(e) => pushParams({ stage: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          <option value="">投资阶段（全部）</option>
          {stageOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={processStage}
          onChange={(e) => pushParams({ process_stage: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          <option value="">流程阶段（全部）</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s] ?? s}
            </option>
          ))}
        </select>
        <select
          value={outcome}
          onChange={(e) => pushParams({ outcome: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          <option value="">投资结论（全部）</option>
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => pushParams({ sort: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(search || stage || processStage || outcome || sort !== "created_desc") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.replace("/projects");
            }}
            className="rounded border border-line px-2 py-1 text-ink-soft hover:bg-surface"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}
