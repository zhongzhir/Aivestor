"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STAGE_LABELS, ALL_STAGES } from "@/lib/stages";

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "待定" },
  { value: "invested", label: "已投" },
  { value: "passed", label: "已 Pass" },
  { value: "exited_profit", label: "盈利退出" },
  { value: "exited_loss", label: "亏损退出" },
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
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `/projects?${qs}` : "/projects");
  }

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
    <div className="mt-5 rounded-lg border border-line bg-white p-4">
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="搜索项目、公司、赛道或判断要点"
        className="w-full rounded-lg border border-line bg-[#fffdfa] px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[#2f6f4f] focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <select
          value={stage}
          onChange={(event) => pushParams({ stage: event.target.value })}
          className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
        >
          <option value="">融资阶段：全部</option>
          {stageOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={processStage}
          onChange={(event) => pushParams({ process_stage: event.target.value })}
          className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
        >
          <option value="">流程阶段：全部</option>
          {ALL_STAGES.map((option) => (
            <option key={option} value={option}>
              {STAGE_LABELS[option] ?? option}
            </option>
          ))}
        </select>
        <select
          value={outcome}
          onChange={(event) => pushParams({ outcome: event.target.value })}
          className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
        >
          <option value="">投资结论：全部</option>
          {OUTCOME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => pushParams({ sort: event.target.value })}
          className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
            className="rounded-md border border-line px-2 py-1.5 text-ink-soft hover:bg-surface"
          >
            清除筛选
          </button>
        )}
      </div>
    </div>
  );
}
