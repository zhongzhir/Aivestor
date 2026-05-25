import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildKnowledgeSnapshot,
  exportDateStr,
  type ExportKnowledgeEntry,
} from "@/lib/export";

export const dynamic = "force-dynamic";

// GET /api/export/knowledge-snapshot
// 读取该用户全部知识库条目，按分组渲染为 Markdown，作为 .md 文件返回。
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const entries = await query<ExportKnowledgeEntry>(
    `SELECT entry_type, source_type, title, content, tags, created_at
       FROM knowledge_base_entries
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [session.user.id]
  );

  const markdown = buildKnowledgeSnapshot(entries);
  const filename = `aivestor-knowledge-${exportDateStr()}.md`;

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
