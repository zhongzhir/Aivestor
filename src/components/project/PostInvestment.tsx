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
const METRIC_KEYWORDS = [
  "ARR",
  "MRR",
  "GMV",
  "DAU",
  "MAU",
  "收入",
  "营收",
  "利润",
  "毛利",
  "现金",
  "用户",
  "客户",
  "订单",
  "留存",
  "续费",
  "门店",
];

const UPDATE_PLACEHOLDERS: Record<string, string> = {
  regular:
    "建议记录：本期收入 / 现金流 / 用户或客户变化 / 关键经营动作 / 下期重点。",
  milestone:
    "建议记录：事项名称、发生时间、影响范围、需要投资人跟进的事项。",
  risk:
    "建议记录：风险信号、触发原因、影响判断、当前应对和下次复核时间。",
  financing:
    "建议记录：融资轮次、目标金额、估值、潜在投资方、进度和稀释影响。",
  personnel:
    "建议记录：人员变化、岗位影响、替代安排、对经营或治理的影响。",
  exit:
    "建议记录：退出路径、潜在买方或市场窗口、估值判断、回款安排和保留观察点。",
};

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "未设定";
}

function splitSentences(content: string) {
  return content
    .split(/[\n。；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractMetricSignals(updates: Update[]) {
  const signals: { text: string; period: string | null; created_at: string }[] = [];
  for (const update of updates) {
    for (const sentence of splitSentences(update.content)) {
      const hasMetric = METRIC_KEYWORDS.some((keyword) =>
        sentence.toLowerCase().includes(keyword.toLowerCase())
      );
      const hasValue = /\d|%|万|亿|千|百/.test(sentence);
      if (hasMetric && hasValue) {
        signals.push({
          text: sentence.length > 90 ? `${sentence.slice(0, 90)}...` : sentence,
          period: update.period,
          created_at: update.created_at,
        });
      }
      if (signals.length >= 6) return signals;
    }
  }
  return signals;
}

function buildLpSnapshot(updates: Update[], meetings: Meeting[]) {
  const latestRegular = updates.find((u) => u.update_type === "regular");
  const latestMilestone = updates.find((u) => u.update_type === "milestone");
  const latestRisk = updates.find((u) => u.update_type === "risk");
  const latestExit = updates.find((u) => u.update_type === "exit");
  const latestMeeting = meetings[0];

  return [
    {
      label: "经营进展",
      value: latestRegular
        ? firstSentence(latestRegular.content)
        : "等待本期经营更新",
    },
    {
      label: "重大事项",
      value: latestMilestone
        ? firstSentence(latestMilestone.content)
        : "暂无需要单独披露的事项",
    },
    {
      label: "风险与应对",
      value: latestRisk ? firstSentence(latestRisk.content) : "暂无新的风险记录",
    },
    {
      label: "退出判断",
      value: latestExit ? firstSentence(latestExit.content) : "退出路径待持续观察",
    },
    {
      label: "最近沟通",
      value: latestMeeting
        ? `${latestMeeting.title}（${formatDate(latestMeeting.meeting_date)}）`
        : "暂无会议记录",
    },
  ];
}

function firstSentence(content: string) {
  return splitSentences(content)[0]?.slice(0, 80) || "已记录，待补充摘要";
}

export function PostInvestment({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState<string | null>(null);

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

  const latestUpdate = updates[0] ?? null;
  const riskCount = updates.filter((u) => u.update_type === "risk").length;
  const exitCount = updates.filter((u) => u.update_type === "exit").length;
  const financingCount = updates.filter((u) => u.update_type === "financing").length;
  const milestoneCount = updates.filter((u) => u.update_type === "milestone").length;
  const metricSignals = extractMetricSignals(updates);
  const latestRisks = updates.filter((u) => u.update_type === "risk").slice(0, 3);
  const exitSignals = updates
    .filter((u) => u.update_type === "exit" || u.update_type === "financing")
    .slice(0, 3);
  const lpSnapshot = buildLpSnapshot(updates, meetings);
  const nextMeeting = meetings
    .map((m) => m.next_meeting_date)
    .filter((d): d is string => !!d)
    .sort()[0];

  return (
    <div className="mt-6 space-y-8">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">投后管理总览</h2>
            <p className="mt-1 text-xs leading-5 text-ink-faint">
              投后阶段重点关注经营进展、重大事项、风险信号和退出路径。这里先把记录入口和管理视图集中起来。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowUpdateModal("regular")}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
            >
              记录经营跟踪
            </button>
            <button
              onClick={() => setShowUpdateModal("exit")}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42]"
            >
              更新退出策略
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <PostMetric label="最近更新" value={latestUpdate ? formatDate(latestUpdate.created_at) : "暂无"} note={latestUpdate ? updateTypeDef(latestUpdate.update_type).label : "可先记录一次经营跟踪"} />
          <PostMetric label="风险信号" value={`${riskCount} 条`} note="经营、现金流或治理风险" />
          <PostMetric label="退出相关" value={`${exitCount} 条`} note="IPO、并购、回购或二级转让" />
          <PostMetric label="下次会议" value={formatDate(nextMeeting)} note="可在会议记录里维护" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PostWorkstream
            title="经营跟踪"
            description="收入、利润、现金流、用户和关键 KPI 的持续记录。"
            action="新增经营记录"
            onClick={() => setShowUpdateModal("regular")}
          />
          <PostWorkstream
            title="重大事项"
            description="融资进展、核心人员变化、诉讼、治理和业务转向。"
            action="新增重大事项"
            onClick={() => setShowUpdateModal("milestone")}
          />
          <PostWorkstream
            title="风险预警"
            description="记录偏离预期的信号，并保留后续观察口径。"
            action="新增风险信号"
            onClick={() => setShowUpdateModal("risk")}
          />
          <PostWorkstream
            title="退出策略"
            description="跟踪退出窗口、潜在买方、回购安排和继续持有理由。"
            action="维护退出判断"
            onClick={() => setShowUpdateModal("exit")}
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-ink">指标监控</h3>
                <p className="mt-1 text-xs leading-5 text-ink-faint">
                  从投后更新中提取带数值的经营信号，用于快速回看变化。
                </p>
              </div>
              <button
                onClick={() => setShowUpdateModal("regular")}
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface"
              >
                记录指标
              </button>
            </div>
            {metricSignals.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-4 text-xs text-ink-faint">
                暂无可识别的指标。记录收入、现金流、用户、续费、GMV 等带数值的信息后，这里会自动汇总。
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {metricSignals.map((signal, index) => (
                  <div
                    key={`${signal.created_at}-${index}`}
                    className="rounded-lg border border-line bg-white px-3 py-2"
                  >
                    <p className="text-xs leading-5 text-ink">{signal.text}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {signal.period || "未标注周期"} · {formatDate(signal.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-4">
            <h3 className="text-xs font-semibold text-ink">收益与退出视图</h3>
            <div className="mt-3 grid gap-3 text-xs text-ink-soft">
              <p>融资动态：已记录 {financingCount} 条，后续可用于估值和稀释复盘。</p>
              <p>退出路径：持续比较 IPO、并购、回购、二级转让和继续持有。</p>
              <p>收益判断：先记录关键事实，后续再接入持仓成本、当前估值和预期回报。</p>
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">投后监控台</h2>
            <p className="mt-1 text-xs leading-5 text-ink-faint">
              把经营指标、重大事项、风险和退出路径放在同一张管理视图里，方便例会前快速进入状态。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowUpdateModal("risk")}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
            >
              记录风险
            </button>
            <button
              onClick={() => setShowUpdateModal("milestone")}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface"
            >
              记录重大事项
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <PostMonitorColumn
            title="重大事项"
            count={milestoneCount}
            empty="暂无重大事项记录"
            items={updates.filter((u) => u.update_type === "milestone").slice(0, 3)}
          />
          <PostMonitorColumn
            title="风险信号"
            count={riskCount}
            empty="暂无风险记录"
            items={latestRisks}
          />
          <PostMonitorColumn
            title="退出与融资"
            count={exitCount + financingCount}
            empty="暂无退出或融资记录"
            items={exitSignals}
          />
        </div>

        <div className="mt-5 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-xs font-semibold text-ink">LP 快照素材</h3>
              <p className="mt-1 text-xs leading-5 text-ink-faint">
                先把可复用信息整理成素材，后续接入 LP 报告模板和导出历史。
              </p>
            </div>
            <button
              onClick={() => setShowUpdateModal("regular")}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-[#265b42]"
            >
              补充本期更新
            </button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {lpSnapshot.map((item) => (
              <div key={item.label} className="rounded-lg border border-line bg-white p-3">
                <div className="text-[11px] font-medium text-ink-faint">{item.label}</div>
                <p className="mt-1 text-xs leading-5 text-ink-soft">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
            onClick={() => setShowUpdateModal("regular")}
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
          initialType={showUpdateModal}
          onClose={() => setShowUpdateModal(null)}
          onSaved={() => {
            setShowUpdateModal(null);
            loadUpdates();
          }}
        />
      )}
    </div>
  );
}

function PostMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-soft">{note}</div>
    </div>
  );
}

function PostWorkstream({
  title,
  description,
  action,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mt-2 min-h-[40px] text-xs leading-5 text-ink-soft">
        {description}
      </p>
      <button
        onClick={onClick}
        className="mt-3 text-xs font-medium text-accent hover:underline"
      >
        {action}
      </button>
    </div>
  );
}

function PostMonitorColumn({
  title,
  count,
  empty,
  items,
}: {
  title: string;
  count: number;
  empty: string;
  items: Update[];
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink-faint">
          {count} 条
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-white px-3 py-4 text-xs text-ink-faint">
          {empty}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const def = updateTypeDef(item.update_type);
            return (
              <div key={item.id} className="rounded-lg border border-line bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${def.badgeClass}`}>
                    {def.icon} {def.label}
                  </span>
                  <span>{item.period || formatDate(item.created_at)}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-ink-soft">
                  {firstSentence(item.content)}
                </p>
              </div>
            );
          })}
        </div>
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
  initialType,
  onClose,
  onSaved,
}: {
  projectId: string;
  initialType: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [updateType, setUpdateType] = useState(initialType);
  const [period, setPeriod] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const placeholder =
    UPDATE_PLACEHOLDERS[updateType] ?? UPDATE_PLACEHOLDERS.regular;

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
            placeholder={placeholder}
            rows={5}
            className="w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs leading-5 text-ink-faint">{placeholder}</p>
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
