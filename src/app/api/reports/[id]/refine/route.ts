import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import {
  buildRefineMessages,
  loadUserAICredentials,
  streamTextResponse,
  freeQuotaMetaFor,
} from "@/lib/report";
import { injectProfile } from "@/lib/user-profile";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

export const maxDuration = 120;

interface ReportRow {
  content: string;
  version: number;
  conversation_history: { instruction: string; ts: string }[];
}

// POST /api/reports/[id]/refine — 按自然语言指令修改报告（流式）
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const creds = await loadUserAICredentials(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请先在设置中保存" },
      { status: 400 }
    );
  }

  let body: { instruction?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json({ error: "请输入修改指令" }, { status: 400 });
  }

  // 报告可见性跟随项目；analyst 不可见 kind='committee'。
  // 个人版退化为 "user_id = $2"，与现状等价。
  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    excludeMergedForAnalyst: true,
  });
  const reports = await query<ReportRow>(
    `SELECT content, version, conversation_history
       FROM reports WHERE id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (reports.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  const report = reports[0];

  const { system, messages } = buildRefineMessages({
    currentReport: report.content,
    instruction,
  });

  const generator = streamChat({
    provider: creds.provider,
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    freeQuotaMeta: freeQuotaMetaFor(creds, session.user.id, "report-refine"),
    system: await injectProfile(session.user.id, system),
    messages,
  });

  return streamTextResponse(generator, async (fullText) => {
    const history = [
      ...report.conversation_history,
      { instruction, ts: new Date().toISOString() },
    ];
    await query(
      `UPDATE reports
          SET content = $1, version = $2, conversation_history = $3
        WHERE id = $4`,
      [fullText, report.version + 1, JSON.stringify(history), params.id]
    );
  });
}
