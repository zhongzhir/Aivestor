import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeIntelligenceCursor, encodeIntelligenceCursor } from "@/lib/intelligenceCursor";
import { normalizeTaskInput, validateTaskInput } from "@/lib/intelligence";
import { parseNaturalLanguageFallbackAt } from "@/lib/intelligenceNaturalLanguage";
import {
  isCatchupAllowed,
  isSchedulerHeartbeatFresh,
  nextScheduledAt,
  scheduledSlotKey,
} from "@/lib/intelligenceSchedule";
import { evidencePublishedAtForUrl, nextRunAfterDueSlot } from "@/lib/intelligenceRuns";
import { safeIntelligenceExternalUrl } from "@/lib/intelligenceUrl";
import { planIntelligenceQueries } from "@/lib/intelligenceWebSearch";
import { calendarRangeInTimeZone } from "@/lib/intelligenceCalendar";

const now = new Date("2026-11-02T12:00:00.000Z");
const culture = parseNaturalLanguageFallbackAt("收集2026年文化行业并购项目", "Asia/Shanghai", now);
assert.equal(culture.task.executionMode, "manual");
assert.equal(culture.task.lookbackPeriod.kind, "custom");
assert.equal(culture.task.lookbackPeriod.start, "2026-01-01T00:00:00.000Z");
assert.equal(culture.task.lookbackPeriod.end, now.toISOString(), "今年范围必须结束于注入的当前时间，而不是模型知识截止日");

const shanghai = { frequency: "weekly" as const, weekdays: [1], time: "08:00", timezone: "Asia/Shanghai" };
assert.equal(nextScheduledAt(shanghai, new Date("2026-11-01T00:00:00.000Z")).toISOString(), "2026-11-02T00:00:00.000Z");
assert.equal(scheduledSlotKey("task-1", new Date("2026-11-02T00:00:00.000Z")), "scheduled:task-1:2026-11-02T00:00:00.000Z");
assert.equal(isCatchupAllowed(new Date("2026-11-02T00:00:00.000Z"), new Date("2026-11-02T00:17:00.000Z")), true, "晚 17 分钟必须允许补跑");
assert.equal(isCatchupAllowed(new Date("2026-11-01T00:00:00.000Z"), new Date("2026-11-02T00:17:00.000Z")), false, "超过 24 小时不得无限补跑");
assert.equal(
  nextRunAfterDueSlot(
    { frequency: "daily", time: "08:00", timezone: "Asia/Shanghai" },
    new Date("2026-10-01T00:00:00.000Z"),
    now,
    false,
  ).toISOString(),
  "2026-11-03T00:00:00.000Z",
  "超出补跑窗口后必须跳至当前时间之后，不能逐日回放历史槽",
);
assert.equal(isSchedulerHeartbeatFresh(new Date(now.getTime() - 120_000), now), true);
assert.equal(isSchedulerHeartbeatFresh(new Date(now.getTime() - 240_000), now), false);

const springGap = { frequency: "daily" as const, time: "02:30", timezone: "America/New_York" };
assert.equal(nextScheduledAt(springGap, new Date("2026-03-08T04:00:00.000Z")).toISOString(), "2026-03-09T06:30:00.000Z", "DST 不存在的本地时刻应跳至下一有效日");
const fallRepeat = { frequency: "daily" as const, time: "01:30", timezone: "America/New_York" };
const firstOccurrence = new Date("2026-11-01T05:30:00.000Z");
assert.equal(nextScheduledAt(fallRepeat, firstOccurrence).toISOString(), "2026-11-02T06:30:00.000Z", "DST 重复时刻不得产生同一天第二个 slot");

const cursor = encodeIntelligenceCursor({ createdAt: now.toISOString(), id: "0f5dd739-e212-4db6-a0a7-02aa613db07b" });
assert.deepEqual(decodeIntelligenceCursor(cursor), { createdAt: now.toISOString(), id: "0f5dd739-e212-4db6-a0a7-02aa613db07b" });
assert.equal(decodeIntelligenceCursor("bad"), null);
assert.equal(safeIntelligenceExternalUrl("javascript:alert(1)"), null);
assert.equal(safeIntelligenceExternalUrl("data:text/html,<script>alert(1)</script>"), null);
assert.equal(safeIntelligenceExternalUrl("https://user:secret@example.com/report"), null);
assert.equal(safeIntelligenceExternalUrl("https://example.com/report"), "https://example.com/report");
assert.equal(safeIntelligenceExternalUrl(`https://example.com/${"a".repeat(1800)}`), null, "超长 URL 不得让 evidence 索引拖垮整次原子完成");
const perSourceDates = [
  { url: "https://source-a.example/event", publishedAt: "2026-08-08T00:00:00.000Z" },
  { url: "https://source-b.example/event", publishedAt: "2026-08-10T00:00:00.000Z" },
];
assert.equal(evidencePublishedAtForUrl(perSourceDates[0].url, "2026-08-08", perSourceDates, 2), perSourceDates[0].publishedAt);
assert.equal(evidencePublishedAtForUrl(perSourceDates[1].url, "2026-08-08", perSourceDates, 2), perSourceDates[1].publishedAt, "多来源 evidence 必须使用各 URL 自己的发布日期");
assert.equal(evidencePublishedAtForUrl("https://unknown.example", "2026-08-08", perSourceDates, 2), null, "多来源缺逐源日期时不得复制 item 日期");
assert.deepEqual(
  calendarRangeInTimeZone("2026-11-01", "2026-11-02", "Asia/Shanghai", now),
  { start: "2026-10-31T16:00:00.000Z", end: now.toISOString() },
  "选择本地今天时结束时间应截到 now，不能拼成未来 UTC 日末",
);

const future = normalizeTaskInput({
  name: "bad future",
  isActive: true,
  lookbackPeriod: { kind: "custom", start: "2026-11-01T00:00:00.000Z", end: "2026-11-05T00:00:00.000Z" },
});
assert.equal(validateTaskInput(future, now), "自定义结束时间不能晚于当前时间", "服务端必须拒绝未来范围，不能静默 clamp");

const eventAware = normalizeTaskInput({
  name: "机器人资本动态",
  topics: ["机器人"],
  eventTypes: ["并购", "融资"],
  lookbackPeriod: { kind: "days", value: 7 },
  isActive: true,
});
assert.deepEqual(eventAware.eventTypes, ["并购", "融资"], "事件类型必须进入权威研究输入，不能只存在 UI 配置中");
assert.match(planIntelligenceQueries(eventAware).join(" "), /并购/);
assert.match(planIntelligenceQueries(eventAware).join(" "), /融资/);

const migration = readFileSync(join(process.cwd(), "db/migrations/051_intelligence_workspace.sql"), "utf8");
const worker = readFileSync(join(process.cwd(), "scripts/run-intelligence-worker.ts"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS intelligence_runs/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS intelligence_run_external_attempts/);
assert.match(migration, /status\s+TEXT NOT NULL CHECK \(status IN \('reserved', 'completed', 'failed', 'uncertain'\)\)/);
assert.match(migration, /config_snapshot\s+JSONB NOT NULL/);
assert.match(migration, /FOREIGN KEY \(task_id, user_id\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS intelligence_run_evidence/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS intelligence_run_request_keys/);
assert.match(migration, /provider_call_state\s+TEXT NOT NULL DEFAULT 'none'/);
assert.match(migration, /UNIQUE \(run_id, item_key, canonical_url\)/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_briefs_run/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_runs_task_active/);
assert.doesNotMatch(migration, /intelligence_runs[\s\S]{0,1200}brief_id/i, "run 不得反向保存 brief_id 形成双向冗余");
assert.match(worker, /schedulerTimer[\s\S]*schedulingCycle/, "长研究期间必须独立刷新调度/入队周期健康状态");
assert.ok(worker.indexOf("recordIntelligenceSchedulerCycle(workerKey, true)") < worker.indexOf("processNextIntelligenceRun(workerKey)"), "调度成功必须在长研究执行前记录");

console.log("intelligence workspace tests passed");
