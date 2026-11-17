"use client";

import { useState } from "react";

export interface ConversationListItem {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  updated_at: string;
}

interface Props {
  items: ConversationListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => Promise<void> | void;
  creating?: boolean;
}

type Group = "today" | "yesterday" | "earlier";
const GROUP_LABEL: Record<Group, string> = {
  today: "今天",
  yesterday: "昨天",
  earlier: "更早",
};

function bucket(ts: string): Group {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  if (d >= startOfToday) return "today";
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (d >= startOfYesterday) return "yesterday";
  return "earlier";
}

export function ConversationList({
  items,
  activeId,
  onSelect,
  onNew,
  onDelete,
  creating,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const grouped: Record<Group, ConversationListItem[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const it of items) grouped[bucket(it.updated_at)].push(it);

  return (
    <aside aria-label="对话历史" className="flex h-full w-full shrink-0 flex-col border-r border-slate-100 bg-slate-50/80 md:w-56">
      {activeId && <div className="p-3 pb-1">
        <button
          type="button"
          onClick={onNew}
          disabled={creating}
          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          新对话
        </button>
      </div>}

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {items.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">还没有历史记录</p>
        ) : (
          (["today", "yesterday", "earlier"] as Group[]).map((g) => {
            const list = grouped[g];
            if (list.length === 0) return null;
            return (
              <div key={g} className="mb-4">
                <p className="px-3 text-xs font-medium text-slate-500">
                  {GROUP_LABEL[g]}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {list.map((it) => {
                    const active = it.id === activeId;
                    return (
                      <li
                        key={it.id}
                        className={`group relative rounded-lg ${
                          active ? "bg-accent-soft" : "hover:bg-slate-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(it.id)}
                          aria-current={active ? "true" : undefined}
                          className="block min-h-11 w-full rounded-lg px-3 py-2.5 pr-9 text-left"
                        >
                          <div
                            className={`truncate text-sm ${
                              active
                                ? "font-medium text-accent"
                                : "text-slate-600"
                            }`}
                          >
                            {it.title || "新对话"}
                          </div>
                          {it.project_name && (
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {it.project_name}
                            </div>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (pendingDelete === it.id) {
                              setPendingDelete(null);
                              await onDelete(it.id);
                            } else {
                              setPendingDelete(it.id);
                              window.setTimeout(
                                () =>
                                  setPendingDelete((cur) =>
                                    cur === it.id ? null : cur
                                  ),
                                3000
                              );
                            }
                          }}
                          aria-label={pendingDelete === it.id ? "确认删除对话" : "删除对话"}
                          className={`absolute right-1 top-1.5 min-h-9 min-w-8 rounded-md px-1.5 text-xs ${
                            pendingDelete === it.id
                              ? "bg-red-500 text-white"
                              : "text-slate-500 opacity-100 hover:bg-slate-200 hover:text-ink focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          }`}
                        >
                          {pendingDelete === it.id ? "确认删除" : "×"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
