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
  { value: "priority_desc", label: "重点优先" },
];

interface Props {
  stageOptions: string[];
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

export function ProjectFilters({ stageOptions, categories, tags }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsRef = useRef(new URLSearchParams(searchParams.toString()));

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMount = useRef(true);

  const stage = searchParams.get("stage") ?? "";
  const processStage = searchParams.get("process_stage") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const category = searchParams.get("category") ?? "";
  const tag = searchParams.get("tag") ?? "";
  const priority = searchParams.get("priority") === "1";
  const sort = searchParams.get("sort") ?? "created_desc";
  const advancedFilterCount = [stage, processStage, outcome, category, tag].filter(Boolean).length
    + (sort !== "created_desc" ? 1 : 0);

  useEffect(() => {
    paramsRef.current = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(paramsRef.current.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    paramsRef.current = params;
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
    <section className="mt-5 rounded-lg border border-line bg-white p-3 sm:p-4" aria-label="项目筛选">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索项目、公司、赛道或判断要点"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-[#fffdfa] px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
        <label className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${priority ? "border-accent bg-accent-soft text-accent" : "border-line bg-white text-ink-soft hover:bg-surface"}`}>
          <input className="sr-only" type="checkbox" checked={priority} onChange={(event) => pushParams({ priority: event.target.checked ? "1" : "" })} />
          <span aria-hidden="true">{priority ? "★" : "☆"}</span>
          <span className="hidden sm:inline">重点项目</span>
          <span className="sm:hidden">重点</span>
        </label>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="project-advanced-filters"
          onClick={() => setFiltersOpen((value) => !value)}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border px-3 text-xs font-medium md:hidden ${filtersOpen || advancedFilterCount > 0 ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft"}`}
        >
          筛选{advancedFilterCount > 0 ? ` ${advancedFilterCount}` : ""}
        </button>
      </div>
      <div
        id="project-advanced-filters"
        className={`${filtersOpen ? "grid" : "hidden"} mt-3 grid-cols-2 gap-2 text-xs md:flex md:flex-wrap`}
      >
        <select
          value={stage}
          onChange={(event) => pushParams({ stage: event.target.value })}
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
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
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
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
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
        >
          <option value="">投资结论：全部</option>
          {OUTCOME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(event) => pushParams({ category: event.target.value })}
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
        >
          <option value="">分类：全部</option>
          {categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <select
          value={tag}
          onChange={(event) => pushParams({ tag: event.target.value })}
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
        >
          <option value="">标签：全部</option>
          {tags.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <select
          value={sort}
          onChange={(event) => pushParams({ sort: event.target.value })}
          className="min-h-11 min-w-0 rounded-md border border-line bg-white px-2 py-2 text-ink md:min-h-0 md:py-1.5"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {(search || stage || processStage || outcome || category || tag || priority || sort !== "created_desc") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              paramsRef.current = new URLSearchParams();
              router.replace("/projects");
            }}
            className="col-span-2 min-h-11 rounded-md border border-line px-3 py-2 text-ink-soft hover:bg-surface md:min-h-0 md:py-1.5"
          >
            清除筛选
          </button>
        )}
      </div>
    </section>
  );
}
