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
  { value: "priority_desc", label: "重点优先" },
];

export function ArchiveFilters({ categories, tags }: { categories: { id: string; name: string }[]; tags: { id: string; name: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsRef = useRef(new URLSearchParams(searchParams.toString()));

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMount = useRef(true);

  const processStage = searchParams.get("process_stage") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const sort = searchParams.get("sort") ?? "updated_desc";
  const category = searchParams.get("category") ?? "";
  const tag = searchParams.get("tag") ?? "";
  const priority = searchParams.get("priority") === "1";

  useEffect(() => {
    paramsRef.current = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(paramsRef.current.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    paramsRef.current = params;
    const qs = params.toString();
    router.replace(qs ? `/archive?${qs}` : "/archive");
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
        <select value={category} onChange={(e) => pushParams({ category: e.target.value })} className="rounded border border-line px-2 py-1 text-ink"><option value="">分类（全部）</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={tag} onChange={(e) => pushParams({ tag: e.target.value })} className="rounded border border-line px-2 py-1 text-ink"><option value="">标签（全部）</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <label className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-ink"><input type="checkbox" checked={priority} onChange={(e) => pushParams({ priority: e.target.checked ? "1" : "" })} />仅看重点</label>
        {(search || processStage || outcome || category || tag || priority || sort !== "updated_desc") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              paramsRef.current = new URLSearchParams();
              router.replace("/archive");
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
