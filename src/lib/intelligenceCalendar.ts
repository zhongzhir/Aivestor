function partsAt(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

function instantForLocal(date: string, endOfDay: boolean, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("日期格式无效");
  const desired = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: endOfDay ? 23 : 0, minute: endOfDay ? 59 : 0, second: endOfDay ? 59 : 0,
  };
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  let value = new Date(desiredAsUtc);
  for (let index = 0; index < 4; index += 1) {
    const actual = partsAt(value, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    value = new Date(value.getTime() + desiredAsUtc - actualAsUtc);
  }
  const verified = partsAt(value, timeZone);
  if (verified.year !== desired.year || verified.month !== desired.month || verified.day !== desired.day || verified.hour !== desired.hour || verified.minute !== desired.minute) {
    throw new Error("该时区的本地日期无有效边界");
  }
  if (endOfDay) value = new Date(value.getTime() + 999);
  return value;
}

export function localCalendarDate(value: Date, timeZone: string): string {
  const parts = partsAt(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function calendarRangeInTimeZone(startDate: string, endDate: string, timeZone: string, now = new Date()) {
  const start = instantForLocal(startDate, false, timeZone);
  const localToday = localCalendarDate(now, timeZone);
  const end = endDate === localToday ? now : instantForLocal(endDate, true, timeZone);
  if (start >= end) throw new Error("查询开始日期必须早于结束日期");
  return { start: start.toISOString(), end: end.toISOString() };
}
