"use client";

import { useEffect, useState } from "react";
import {
  MEETING_TYPES,
  meetingTypeLabel,
  UPDATE_TYPE_CONFIG,
  updateTypeDef,
} from "@/lib/postInvestment";
import { readError } from "@/lib/clientAI";

interface AiSummary {
  decisions?: string[];
  risks?: string[];
  actions?: string[];
  next_focus?: string[];
}

interface Meeting {
  id: string;
  title: string;
  meeting_date: string | null;
  meeting_type: string;
  participants: string[];
  content: string;
  ai_summary: AiSummary | null;
  next_meeting_date: string | null;
  created_at: string;
}

interface Update {
  id: string;
  update_type: string;
  content: string;
  period: string | null;
  created_at: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function PostInvestment({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  async function loadMeetings() {
    const res = await fetch(`/api/projects/${projectId}/meetings`);
    if (res.ok) setMeetings((await res.json()).meetings ?? []);
  }
  async function loadUpdates() {
    const res = await fetch(`/api/projects/${projectId}/updates`);
    if (res.ok) setUpdates((await res.json()).updates ?? []);
  }

  useEffect(() => {
    loadMeetings();
    loadUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-6 space-y-8">
      {/* 会议记录 */}
      <section>
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 className="text-sm font-medium text-ink">会议记录</h2>
          <button
            onClick={() => setShowMeetingModal(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            + 新增会议记录
          </button>
        </div>
        {meetings.length === 0 ? (
          <p className="mt-3 text-xs text-ink-faint">暂无会议记录</p>
        ) : (
          <div className="mt-3 space-y-3">
            {meetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} projectId={projectId} />
            ))}
          </div>
        )}
      </section>

      {/* 跟踪记录 */}
      <section>
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 className="text-sm font-medium text-ink">跟踪记录</h2>
          <button
            onClick={() => setShowUpdateModal(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            + 新增更新
          </button>
        </div>
        {updates.length === 0 ? (
          <p className="mt-3 text-xs text-ink-faint">暂无跟踪记录</p>
        ) : (
          <div className="mt-3 space-y-2">
            {updates.map((u) => {
              const def = updateTypeDef(u.update_type);
              return (
                <div
                  key={u.id}
                  className="rounded-lg border border-line bg-surface p-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${def.badgeClass}`}
                    >
                      {def.icon} {def.label}
                    </span>
                    {u.period && (
                      <span className="text-ink-faint">{u.period}</span>
                    )}
                    <span className="text-ink-faint">
                      {new Date(u.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-soft">
                    {u.content}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showMeetingModal && (
        <MeetingModal
          projectId={projectId}
          onClose={() => setShowMeetingModal(false)}
          onSaved={() => {
            setShowMeetingModal(false);
            loadMeetings();
          }}
        />
      )}
      {showUpdateModal && (
        <UpdateModal
          projectId={projectId}
          onClose={() => setShowUpdateModal(false)}
          onSaved={() => {
            setShowUpdateModal(false);
            loadUpdates();
          }}
        />
      )}
    </div>
  );
}

function MeetingCard({
  meeting,
  projectId,
}: {
  meeting: Meeting;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<AiSummary | null>(meeting.ai_summary);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");

  async function summarize() {
    setSummarizing(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meeting.id}/summarize`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error(await readError(res, "摘要生成失败"));
      }
      setSummary((await res.json()).ai_summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "摘要生成失败");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-faint">
          {meeting.meeting_date
            ? new Date(meeting.meeting_date).toLocaleDateString("zh-CN")
            : "—"}
        </span>
        <span className="font-medium text-ink">{meeting.title}</span>
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
          {meetingTypeLabel(meeting.meeting_type)}
        </span>
      </div>
      {meeting.participants?.length > 0 && (
        <p className="mt-1 text-xs text-ink-faint">
          参与方：{meeting.participants.join("、")}
        </p>
      )}

      {summary ? (
        <div className="mt-2 space-y-1 text-xs text-ink-soft">
          <SummaryLine label="核心决议" items={summary.decisions} />
          <SummaryLine label="风险信号" items={summary.risks} />
          <SummaryLine label="行动项" items={summary.actions} />
          <SummaryLine label="下次重点" items={summary.next_focus} />
        </div>
      ) : (
        <button
          onClick={summarize}
          disabled={summarizing}
          className="mt-2 text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          {summarizing ? "AI 分析中…" : "生成 AI 摘要"}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <div className="mt-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-ink-faint hover:text-ink"
        >
          {expanded ? "收起" : "查看全文"}
        </button>
        {expanded && (
          <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-canvas p-3 text-xs text-ink-soft">
            {meeting.content}
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  items,
}: {
  label: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <p>
      <span className="font-medium text-ink-soft">{label}：</span>
      {items.join("；")}
    </p>
  );
}

function MeetingModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingType, setMeetingType] = useState<string>(MEETING_TYPES[0].value);
  const [participants, setParticipants] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(withSummary: boolean) {
    if (!title.trim()) {
      setError("请填写会议标题");
      return;
    }
    if (!meetingDate) {
      setError("请选择会议日期");
      return;
    }
    if (!content.trim()) {
      setError("请填写会议内容");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          title,
          meeting_date: meetingDate,
          meeting_type: meetingType,
          participants,
          content,
          next_meeting_date: nextDate || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "保存失败"));
      }
      const { meeting } = await res.json();
      if (withSummary && meeting?.id) {
        await fetch(
          `/api/projects/${projectId}/meetings/${meeting.id}/summarize`,
          { method: "POST" }
        );
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <ModalShell title="新增会议记录" onClose={onClose}>
      <div className="space-y-3">
        <Field label="标题" required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="会议日期" required>
            <input
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <Field label="会议类型">
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {MEETING_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="参与方">
          <input
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="多个参与方用、或逗号分隔"
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        <Field label="下次会议日期">
          <input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        <Field label="会议内容" required>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "处理中…" : "保存并生成AI摘要"}
        </button>
      </div>
    </ModalShell>
  );
}

function UpdateModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [updateType, setUpdateType] = useState("regular");
  const [period, setPeriod] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!content.trim()) {
      setError("请填写更新内容");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/updates`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          update_type: updateType,
          period: period || undefined,
          content,
        }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "保存失败"));
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <ModalShell title="新增跟踪更新" onClose={onClose}>
      <div className="space-y-3">
        <Field label="更新类型">
          <select
            value={updateType}
            onChange={(e) => setUpdateType(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {Object.entries(UPDATE_TYPE_CONFIG).map(([v, def]) => (
              <option key={v} value={v}>
                {def.icon} {def.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="跟踪周期">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="如：2026Q1"
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        <Field label="内容" required>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-canvas p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="text-sm text-ink-faint hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-ink-soft">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
