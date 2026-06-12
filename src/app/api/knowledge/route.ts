import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

export const maxDuration = 30;

interface KBRow {
  id: string;
  content: string;
  source_type: string | null;
  entry_type: string | null;
  structured_data: Record<string, unknown> | null;
  tags: string[];
  embedding_model: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  author_name?: string | null;
}

const ALLOWED_ENTRY_TYPES = new Set([
  "industry",
  "project",
  "thesis",
  "prediction",
  "chunk",
  "manual",
  "conversation_digest",
  "document_chunk",
]);
const ALLOWED_SOURCE_TYPES = new Set(["manual", "document", "report"]);

// GET /api/knowledge?page=1&entry_type=a,b&source_type=manual&sort=created_desc
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  const entryTypes = (sp.get("entry_type") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && ALLOWED_ENTRY_TYPES.has(s));
  const sourceTypeRaw = (sp.get("source_type") ?? "").trim();
  const sourceType = ALLOWED_SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : "";

  // 层筛选：layer=org 显示机构沉淀层（含他人条目+作者名）；
  // 默认（个人层）= 本人且仍在个人层（visibility='private'）的条目。
  // 必须带 visibility='private'：晋升是"移动不是复制"（架构 3.4），条目 user_id
  // 不变、仅 visibility 改为 'org'（架构 3.1），若个人层只看 user_id 不看
  // visibility，已晋升条目会同时出现在个人层与机构层（复制视觉假象）。
  // 回归安全：未晋升条目 visibility 默认即 'private'（迁移 022），结果不变。
  const layer = (sp.get("layer") ?? "").trim();
  let baseWhere: string;
  const params: unknown[] = [];
  let withAuthor = false;
  if (layer === "org") {
    const scope = await buildAccessScope(session.user.id);
    if (!scope.org || !(await hasCapability(scope.org.orgId, "org_knowledge"))) {
      return NextResponse.json({ entries: [], total: 0, page });
    }
    params.push(scope.org.orgId);
    baseWhere = "kb.org_id = $1 AND kb.visibility = 'org'";
    withAuthor = true;
  } else {
    params.push(session.user.id);
    baseWhere = "kb.user_id = $1 AND kb.visibility = 'private'";
  }

  const where: string[] = [baseWhere];
  if (entryTypes.length > 0) {
    params.push(entryTypes);
    where.push(`kb.entry_type = ANY($${params.length}::text[])`);
  }
  if (sourceType) {
    params.push(sourceType);
    where.push(`kb.source_type = $${params.length}`);
  }

  const authorSelect = withAuthor ? ", u.name AS author_name" : "";
  const authorJoin = withAuthor ? "LEFT JOIN users u ON u.id = kb.user_id" : "";

  params.push(limit);
  params.push(offset);
  const entries = await query<KBRow>(
    `SELECT kb.id, kb.content, kb.source_type, kb.entry_type, kb.structured_data,
            kb.tags, kb.embedding_model, kb.metadata, kb.created_at${authorSelect}
       FROM knowledge_base_entries kb
       ${authorJoin}
      WHERE ${where.join(" AND ")}
      ORDER BY kb.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM knowledge_base_entries kb
      WHERE ${where.join(" AND ")}`,
    params.slice(0, params.length - 2)
  );

  return NextResponse.json({
    entries,
    total: countRows[0]?.count ?? 0,
    page,
  });
}

// POST /api/knowledge — 手动录入新条目，同时尝试生成 embedding
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { content?: string; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 422 });
  }
  const tags = Array.isArray(body.tags) ? body.tags : [];

  // 生成 embedding（百炼未配置或失败则仅保留全文检索，不阻断写入）
  let embeddingVector: number[] | null = null;
  let embeddingModel: string | null = null;
  try {
    const result = await generateEmbedding(content);
    if (result) {
      embeddingVector = result.vector;
      embeddingModel = result.model;
    }
  } catch (e) {
    console.warn("[knowledge] embedding 失败，降级为纯文本入库:", e);
  }

  try {
    const inserted = await query<KBRow>(
      `INSERT INTO knowledge_base_entries
         (user_id, content, source_type, tags, embedding, embedding_model)
       VALUES ($1, $2, 'manual', $3, $4, $5)
       RETURNING id, content, source_type, tags, embedding_model, created_at`,
      [
        session.user.id,
        content,
        JSON.stringify(tags),
        embeddingVector ? `[${embeddingVector.join(",")}]` : null,
        embeddingModel,
      ]
    );
    return NextResponse.json({ entry: inserted[0] }, { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string; detail?: string };
    console.error("[knowledge][POST] INSERT 失败:", err);
    return NextResponse.json(
      {
        error: err.message || "存入知识库失败",
        code: err.code,
        detail: err.detail,
      },
      { status: 500 }
    );
  }
}
