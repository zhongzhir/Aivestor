import { NextResponse } from "next/server";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { streamChat } from "@/lib/ai";
import { freeQuotaMetaFor, loadUserAICredentials } from "@/lib/report";
import { parseNaturalLanguageFallbackAt, planFromAIOrFallback, INTELLIGENCE_PARSE_SYSTEM } from "@/lib/intelligenceNaturalLanguage";
import { validateTaskInput } from "@/lib/intelligence";

export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  let body: { description?: string; timezone?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请重新描述你想关注的内容。" }, { status: 400 }); }
  const description = body.description?.trim();
  if (!description) return NextResponse.json({ error: "请先写下你想收集或研究的内容。" }, { status: 422 });
  if (description.length > 1000) return NextResponse.json({ error: "描述稍长，请保留最重要的关注对象和筛选要求。" }, { status: 422 });

  const userTimezone = body.timezone?.trim() || "Asia/Shanghai";
  const now = new Date();
  let currentDate: string;
  try {
    currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: userTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
  const fallback = parseNaturalLanguageFallbackAt(description, userTimezone, now);
  const metadata = { method: "fallback", parsedAt: now.toISOString(), currentDate, warnings: [] as string[] };
  const creds = await loadUserAICredentials(guard.access.userId);
  if (!creds) return NextResponse.json({ plan: fallback, parseMetadata: metadata });
  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider, apiKey: creds.apiKey, baseURL: creds.baseURL, model: creds.model,
      freeQuotaMeta: freeQuotaMetaFor(creds, guard.access.userId, "intelligence-plan"),
      system: `${INTELLIGENCE_PARSE_SYSTEM}\n当前用户时区：${userTimezone}\n当前用户本地日期：${currentDate}\n解析任何“今年、至今、当前”等表达时必须以该日期为准。`,
      messages: [{ role: "user", content: description }],
    })) raw += chunk;
    const plan = planFromAIOrFallback(description, raw, userTimezone, now);
    const validationError = validateTaskInput(plan.task, now);
    if (validationError) return NextResponse.json({ plan: fallback, parseMetadata: metadata });
    return NextResponse.json({ plan, parseMetadata: { ...metadata, method: "ai" } });
  } catch {
    return NextResponse.json({ plan: fallback, parseMetadata: metadata });
  }
}
