import type { ScheduleConfig } from "@/lib/intelligence";

export const INTELLIGENCE_CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INTELLIGENCE_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedScheduleParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const weekday = WEEKDAYS.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
  const result = {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    weekday,
  };
  if (Object.values(result).some((entry) => !Number.isFinite(entry)) || weekday < 0) {
    throw new Error("invalid schedule timezone result");
  }
  return result;
}

export function scheduleMatches(value: Date, config: ScheduleConfig): boolean {
  const [hour, minute] = config.time.split(":").map(Number);
  const parts = zonedScheduleParts(value, config.timezone);
  if (parts.hour !== hour || parts.minute !== minute) return false;
  if (config.frequency === "daily") return true;
  return (config.weekdays ?? []).includes(parts.weekday);
}

/**
 * Return the first wall-clock schedule strictly after `after`.
 * Minute scanning intentionally delegates DST gaps/duplicates to Intl: a missing
 * local minute does not run; a repeated local minute resolves to the first UTC
 * occurrence because callers advance next_run_at immediately and use slot keys.
 */
export function nextScheduledAt(config: ScheduleConfig, after: Date): Date {
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const horizonMinutes = config.frequency === "daily" ? 3 * 24 * 60 : 9 * 24 * 60;
  const previous = scheduleMatches(after, config) ? zonedScheduleParts(after, config.timezone) : null;
  for (let index = 0; index < horizonMinutes; index += 1) {
    const candidate = new Date(start + index * 60_000);
    if (!scheduleMatches(candidate, config)) continue;
    const parts = zonedScheduleParts(candidate, config.timezone);
    if (previous && parts.year === previous.year && parts.month === previous.month && parts.day === previous.day && parts.hour === previous.hour && parts.minute === previous.minute) continue;
    return candidate;
  }
  throw new Error("schedule has no occurrence in supported horizon");
}

export function scheduledSlotKey(taskId: string, scheduledFor: Date): string {
  return `scheduled:${taskId}:${scheduledFor.toISOString()}`;
}

export function isCatchupAllowed(scheduledFor: Date, now: Date): boolean {
  const delay = now.getTime() - scheduledFor.getTime();
  return delay >= 0 && delay <= INTELLIGENCE_CATCHUP_WINDOW_MS;
}

export function isSchedulerHeartbeatFresh(lastHeartbeatAt: string | Date | null | undefined, now = new Date()): boolean {
  if (!lastHeartbeatAt) return false;
  const value = new Date(lastHeartbeatAt).getTime();
  return Number.isFinite(value) && now.getTime() - value <= INTELLIGENCE_HEARTBEAT_STALE_MS;
}
