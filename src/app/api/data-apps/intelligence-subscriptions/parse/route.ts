import { NextResponse } from "next/server";
import { requireCapabilityAPI } from "@/lib/orgAuth";
import { streamChat } from "@/lib/ai";
import { freeQuotaMetaFor, loadUserAICredentials } from "@/lib/report";
import { parseNaturalLanguageFallback, planFromAI, INTELLIGENCE_PARSE_SYSTEM } from "@/lib/intelligenceNaturalLanguage";
import { validateTaskInput } from "@/lib/intelligence";

export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireCapabilityAPI("zjjr_data");
  if (!guard.ok) return guard.response;
  let body: { description?: string; timezone?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请重新描述你想关注的内容。" }, { status: 400 }); }
  const description = body.description?.trim();
  if (!description) return NextResponse.json({ error: "请先写下你想持续关注的内容。" }, { status: 422 });
  if (description.length > 1000) return NextResponse.json({ error: "描述稍长，请保留最重要的关注对象和筛选要求。" }, { status: 422 });

  const userTimezone = body.timezone?.trim() || "Asia/Shanghai";
  const fallback = parseNaturalLanguageFallback(description, userTimezone);
  const creds = await loadUserAICredentials(guard.ctx.userId);
  if (!creds) return NextResponse.json({ plan: fallback });
  let raw = "";
  try {
    for await (const chunk of streamChat({
      provider: creds.provider, apiKey: creds.apiKey, baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, guard.ctx.userId, "intelligence-plan"),
      system: INTELLIGENCE_PARSE_SYSTEM, messages: [{ role: "user", content: description }],
    })) raw += chunk;
    const plan = planFromAI(description, raw, userTimezone);
    const validationError = validateTaskInput(plan.task);
    if (validationError) return NextResponse.json({ plan: fallback });
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ plan: fallback });
  }
}
