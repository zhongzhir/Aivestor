import assert from "node:assert/strict";
import { coverageFor, filterCandidates, normalizeTaskInput, validateTaskInput, type Candidate } from "@/lib/intelligence";

const input = normalizeTaskInput({
  name: "AI赛事监测", topics: ["AI"], entities: ["OpenAI"], keywords: ["奖金"], regions: ["中国"],
  includeRequirements: [], excludeRequirements: ["广告"], maxItems: 2, lookbackPeriod: { kind: "days", value: 3 },
  executionMode: "manual", isActive: false,
});
const now = new Date("2026-08-04T12:00:00.000Z");
const candidates: Candidate[] = [
  { id: "1", title: "AI赛事 OpenAI 中国奖金", content: "重要事实", source: "market", sourceUrl: "https://example.com/1", publishedAt: "2026-08-04T10:00:00.000Z", subject: "OpenAI", region: "中国", kind: "fact" },
  { id: "2", title: "AI赛事 OpenAI 中国趋势", content: "趋势信号", source: "market", sourceUrl: "https://example.com/2", publishedAt: "2026-08-03T10:00:00.000Z", subject: "OpenAI", region: "中国", kind: "trend" },
  { id: "3", title: "AI赛事 其他公司 奖金", content: "广告", source: "market", sourceUrl: "https://example.com/3", publishedAt: "2026-08-04T09:00:00.000Z", subject: "Other", region: "中国", kind: "fact" },
  { id: "4", title: "AI赛事 OpenAI 中国奖金", content: "旧结果", source: "market", sourceUrl: "https://example.com/4", publishedAt: "2026-07-20T09:00:00.000Z", subject: "OpenAI", region: "中国", kind: "fact" },
];
const result = filterCandidates(candidates, input, new Date("2026-08-01T12:00:00.000Z"), now);
assert.equal(result.length, 1, "同一主体应合并、排除项应过滤、时间范围应生效");
assert.equal(result[0].id, "1");
assert.equal(coverageFor(input, now).start.toISOString(), "2026-08-01T12:00:00.000Z");
assert.equal(normalizeTaskInput({ executionMode: "scheduled", scheduleConfig: { frequency: "weekly", time: "08:30", timezone: "Asia/Shanghai" } }).scheduleConfig?.timezone, "Asia/Shanghai");
assert.equal(validateTaskInput(normalizeTaskInput({ name: "bad", executionMode: "scheduled", isActive: true, scheduleConfig: { frequency: "daily", time: "25:00", timezone: "Asia/Shanghai" } })), "定时任务的时间必须是 HH:MM");
assert.equal(validateTaskInput(normalizeTaskInput({ name: "bad", isActive: true, lookbackPeriod: { kind: "custom", start: "2026-08-04T10:00:00.000Z", end: "2026-08-04T09:00:00.000Z" } }), now), "自定义时间范围无效");
assert.equal(validateTaskInput(normalizeTaskInput({ name: "bad", isActive: true, lookbackPeriod: { kind: "days", value: 3 }, executionMode: "scheduled", scheduleConfig: { frequency: "daily", time: "09:00", timezone: "Not/AZone" } }), now), "时区无效");
console.log("intelligence tests passed");
