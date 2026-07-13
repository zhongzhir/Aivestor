"use client";

import { useEffect, useState } from "react";

interface ActionItem {
  id: string;
  title: string;
  owner: string | null;
  due_date: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  note: string | null;
}

interface ExitStrategy {
  primary_path: string;
  alternative_paths: string[];
  target_window: string | null;
  valuation_note: string | null;
  return_note: string | null;
  status: "monitoring" | "preparing" | "executing" | "completed" | "paused";
}

const ACTION_STATUS: Record<ActionItem["status"], string> = {
  open: "待处理",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

const EXIT_STATUS: Record<ExitStrategy["status"], string> = {
  monitoring: "持续观察",
  preparing: "准备中",
  executing: "执行中",
  completed: "已完成",
  paused: "暂缓",
};

const EMPTY_EXIT: ExitStrategy = {
  primary_path: "",
  alternative_paths: [],
  target_window: "",
  valuation_note: "",
  return_note: "",
  status: "monitoring",
};

export function PostInvestmentPlanning({ projectId }: { projectId: string }) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [strategy, setStrategy] = useState<ExitStrategy>(EMPTY_EXIT);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [strategyError, setStrategyError] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [actionNote, setActionNote] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [actionsRes, strategyRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/post-actions`),
        fetch(`/api/projects/${projectId}/exit-strategy`),
      ]);
      if (actionsRes.ok) setActions((await actionsRes.json()).actions ?? []);
      if (strategyRes.ok) {
        const next = (await strategyRes.json()).strategy;
        if (next) setStrategy({ ...EMPTY_EXIT, ...next });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function addAction() {
    if (!actionTitle.trim()) {
      setActionError("请填写行动项");
      return;
    }
    setSavingAction(true);
    setActionError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/post-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: actionTitle,
          owner: actionOwner,
          due_date: actionDueDate,
          note: actionNote,
        }),
      });
      if (!res.ok) throw new Error("行动项保存失败");
      const data = await res.json();
      setActions((current) => [data.action, ...current]);
      setActionTitle("");
      setActionOwner("");
      setActionDueDate("");
      setActionNote("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "行动项保存失败");
    } finally {
      setSavingAction(false);
    }
  }

  async function updateAction(action: ActionItem, status: ActionItem["status"]) {
    const res = await fetch(`/api/projects/${projectId}/post-actions/${action.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setActions((current) => current.map((item) => (item.id === action.id ? data.action : item)));
  }

  async function saveStrategy() {
    if (!strategy.primary_path.trim()) {
      setStrategyError("请填写主要退出路径");
      return;
    }
    setSavingStrategy(true);
    setStrategyError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/exit-strategy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategy),
      });
      if (!res.ok) throw new Error("退出策略保存失败");
      const data = await res.json();
      setStrategy({ ...EMPTY_EXIT, ...data.strategy });
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : "退出策略保存失败");
    } finally {
      setSavingStrategy(false);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
      <div className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">投后行动项</h2>
            <p className="mt-1 text-xs leading-5 text-ink-faint">
              把会议、报告和经营跟踪中需要持续推进的事项集中管理。
            </p>
          </div>
          <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft">
            {actions.filter((item) => !["done", "cancelled"].includes(item.status)).length} 项待推进
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input
            value={actionTitle}
            onChange={(event) => setActionTitle(event.target.value)}
            placeholder="下一项需要推进的工作"
            className="rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent sm:col-span-2"
          />
          <input
            value={actionOwner}
            onChange={(event) => setActionOwner(event.target.value)}
            placeholder="负责人（可选）"
            className="rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            type="date"
            value={actionDueDate}
            onChange={(event) => setActionDueDate(event.target.value)}
            className="rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm text-ink-soft outline-none focus:border-accent"
          />
          <input
            value={actionNote}
            onChange={(event) => setActionNote(event.target.value)}
            placeholder="补充说明（可选）"
            className="rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent sm:col-span-2"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={addAction}
            disabled={savingAction}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50"
          >
            {savingAction ? "保存中" : "新增行动项"}
          </button>
          {actionError && <p className="text-xs text-red-600">{actionError}</p>}
        </div>

        <div className="mt-5 space-y-2">
          {loading ? (
            <p className="text-xs text-ink-faint">正在读取行动项…</p>
          ) : actions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-ink-faint">
              还没有行动项。可以从下一次会议、报告回看或风险复核开始记录。
            </p>
          ) : (
            actions.map((action) => (
              <div key={action.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className={action.status === "done" ? "text-ink-faint line-through" : "text-ink"}>
                    <p className="text-sm font-medium">{action.title}</p>
                    {action.note && <p className="mt-1 text-xs leading-5 text-ink-soft">{action.note}</p>}
                  </div>
                  <select
                    value={action.status}
                    onChange={(event) => updateAction(action, event.target.value as ActionItem["status"])}
                    className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-soft outline-none"
                    aria-label="行动项状态"
                  >
                    {Object.entries(ACTION_STATUS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                  {action.owner && <span>负责人：{action.owner}</span>}
                  {action.due_date && <span>截止：{action.due_date.slice(0, 10)}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">退出策略</h2>
            <p className="mt-1 text-xs leading-5 text-ink-faint">
              记录当前主要路径、备选路径和收益判断，后续随经营变化更新。
            </p>
          </div>
          <select
            value={strategy.status}
            onChange={(event) => setStrategy((current) => ({ ...current, status: event.target.value as ExitStrategy["status"] }))}
            className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-soft outline-none"
            aria-label="退出策略状态"
          >
            {Object.entries(EXIT_STATUS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="mt-4 space-y-3">
          <input
            value={strategy.primary_path}
            onChange={(event) => setStrategy((current) => ({ ...current, primary_path: event.target.value }))}
            placeholder="主要退出路径，例如：产业并购"
            className="w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            value={strategy.alternative_paths.join("、")}
            onChange={(event) => setStrategy((current) => ({ ...current, alternative_paths: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) }))}
            placeholder="备选路径，用顿号分隔"
            className="w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            value={strategy.target_window ?? ""}
            onChange={(event) => setStrategy((current) => ({ ...current, target_window: event.target.value }))}
            placeholder="目标窗口，例如：2028-2029 年"
            className="w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <textarea
            value={strategy.valuation_note ?? ""}
            onChange={(event) => setStrategy((current) => ({ ...current, valuation_note: event.target.value }))}
            placeholder="估值与潜在买方判断"
            className="min-h-20 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <textarea
            value={strategy.return_note ?? ""}
            onChange={(event) => setStrategy((current) => ({ ...current, return_note: event.target.value }))}
            placeholder="回报与回款安排判断"
            className="min-h-20 w-full rounded-md border border-line bg-[#fffdfa] px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveStrategy}
            disabled={savingStrategy}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42] disabled:opacity-50"
          >
            {savingStrategy ? "保存中" : "保存退出策略"}
          </button>
          {strategyError && <p className="text-xs text-red-600">{strategyError}</p>}
        </div>
      </div>
    </section>
  );
}
