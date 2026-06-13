"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STAGE_LABELS, ALL_STAGES } from "@/lib/stages";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "evaluating", label: "评估中" },
  { value: "invested", label: "已投" },
  { value: "passed", label: "已 Pass" },
  { value: "exited", label: "已退出" },
];

// 机构档案筛选条：在归档筛选基础上增加 owner 下拉（管理层视角按成员浏览）。
export function OrgArchiveFilters({
  owners,
}: {
  owners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMount = useRef(true);

  const owner = searchParams.get("owner") ?? "";
  const processStage = searchParams.get("process_stage") ?? "";
  const status = searchParams.get("status") ?? "";

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "org"); // 始终保留机构档案视图标识
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.replace(`/archive?${params.toString()}`);
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

  const hasFilters = search || owner || processStage || status;

  return (
    <div className="mt-6 space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索项目名称…"
        className="w-full rounded border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-[#0D1B3E]"
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <select
          value={owner}
          onChange={(e) => pushParams({ owner: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          <option value="">负责人（全部）</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
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
          value={status}
          onChange={(e) => pushParams({ status: e.target.value })}
          className="rounded border border-line px-2 py-1 text-ink"
        >
          <option value="">状态（全部）</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.replace("/archive?view=org");
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
