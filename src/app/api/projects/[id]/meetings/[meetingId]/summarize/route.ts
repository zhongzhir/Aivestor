import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials, freeQuotaMetaFor } from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

export const maxDuration = 120;

interface MeetingRow {
  title: string;
  meeting_date: string | null;
  participants: string[];
  content: string;
}

// POST /api/projects/[id]/meetings/[meetingId]/summarize — AI 提取会议摘要
export async function POST(
  _req: Request,
  { params }: { params: { id: string; meetingId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const scope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "write");
    } catch (e) {
      return accessErrorResponse(e);
    }

    const rows = await query<MeetingRow>(
      `SELECT title, meeting_date, participants, content
         FROM meeting_notes
        WHERE id = $1 AND project_id = $2`,
      [params.meetingId, params.id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
    }
    const meeting = rows[0];

    const creds = await loadUserAICredentials(session.user.id);
    if (!creds) {
      return NextResponse.json(
        { error: "尚未配置 API Key，请先在设置中保存" },
        { status: 400 }
      );
    }

    const participants = Array.isArray(meeting.participants)
      ? meeting.participants.join("、")
      : "";
    const prompt = `你是一位投资机构的投后管理专家。请对以下会议纪要进行结构化分析。

会议信息：${meeting.title} ${meeting.meeting_date ?? ""} ${participants}
会议内容：
${meeting.content}

请提取：
## 核心决议
本次会议达成的关键决定（3条以内）

## 风险信号
会议中提到的风险点或需要关注的问题

## 行动项
需要跟进的具体事项，含责任方和时间节点

## 下次重点
下次会议需要重点关注的事项

请严格返回以下 JSON 格式，不要包含任何额外说明文字或 Markdown 代码块标记：
{"decisions": [], "risks": [], "actions": [], "next_focus": []}
每个数组元素为一个简短字符串。`;

    // 收集完整 AI 输出（需解析 JSON，故不流式返回）
    let full = "";
    for await (const chunk of streamChat({
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "meeting-summarize"),
      system: await injectProfile(
        session.user.id,
        "你是投后管理专家，只输出合法 JSON，不输出任何其他内容。"
      ),
      messages: [{ role: "user", content: prompt }],
    })) {
      full += chunk;
    }

    // 去除可能的代码块包裹后解析
    const jsonText = full
      .replace(/^[\s\S]*?\{/, "{")
      .replace(/\}[\s\S]*$/, "}");
    let summary: unknown;
    try {
      summary = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "AI 返回格式无法解析，请重试" },
        { status: 502 }
      );
    }

    await query("UPDATE meeting_notes SET ai_summary = $1 WHERE id = $2", [
      JSON.stringify(summary),
      params.meetingId,
    ]);

    return NextResponse.json({ ai_summary: summary });
  } catch (e) {
    console.error("[meetings/summarize] 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "摘要生成失败" },
      { status: 500 }
    );
  }
}
