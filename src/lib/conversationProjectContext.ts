import { query } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { assertProjectAccess, buildAccessScope } from "@/lib/resourceAccess";
import { chunkLocatedText, chunkText } from "@/lib/chunking";
import { normalizeSourceMap } from "@/lib/sourceMap";
import { relevance, researchTerms, type ConversationSource } from "@/lib/conversationResearch";

interface ProjectRow { name: string; stage: string | null; status: string; industry: string | null }
interface ChunkRow { id: string; document_id: string; filename: string; content: string; metadata: { label?: string; locator?: string } | null }

export async function conversationProjectContext(projectId: string, userId: string, question: string) {
  const scope = await buildAccessScope(userId);
  await assertProjectAccess(scope, projectId, "read");
  const [project] = await query<ProjectRow>(
    "SELECT name, stage, status, industry FROM projects WHERE id = $1 AND deleted_at IS NULL", [projectId]
  );
  const [documents, judgments, reports] = await Promise.all([
    query<{ id: string; filename: string; parse_status: string }>(
      "SELECT id, filename, parse_status FROM documents WHERE project_id = $1 ORDER BY created_at DESC", [projectId]),
    query<{ bull_case: string | null; bear_case: string | null; key_hypothesis: string | null }>(
      `SELECT bull_case, bear_case, key_hypothesis FROM investment_judgments
       WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 3`, [projectId, userId]),
    query<{ id: string; content: string; updated_at: string }>(
      "SELECT id, LEFT(content, 12000) AS content, updated_at FROM reports WHERE project_id = $1 AND content IS NOT NULL AND ($2::boolean = false OR kind <> 'committee') ORDER BY updated_at DESC LIMIT 1", [projectId, scope.org?.role === "analyst"]),
  ]);
  let chunks: ChunkRow[] = [];
  let embedding: Awaited<ReturnType<typeof generateEmbedding>> = null;
  try { embedding = await generateEmbedding(`${project.name}\n${question}`); } catch { /* lexical fallback */ }
  if (embedding) {
    chunks = await query<ChunkRow>(
      `SELECT dc.id, dc.document_id, d.filename, dc.content, dc.metadata
       FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
       WHERE d.project_id = $1 AND d.parse_status = 'done' AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $2::vector LIMIT 8`,
      [projectId, `[${embedding.vector.join(",")}]`]
    );
  }
  // Also search text-only chunks (embedding outages must not hide new materials).
  const terms = researchTerms(question);
  const lexical = await query<ChunkRow>(
    `SELECT dc.id, dc.document_id, d.filename, dc.content, dc.metadata
     FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
     WHERE d.project_id = $1 AND d.parse_status = 'done'
     ORDER BY (SELECT COUNT(*) FROM unnest($2::text[]) t(term) WHERE STRPOS(LOWER(dc.content), t.term) > 0) DESC,
              d.created_at DESC, dc.chunk_index ASC LIMIT 8`, [projectId, terms]);
  const unique = new Map<string, ChunkRow>();
  for (const chunk of [...chunks, ...lexical]) unique.set(chunk.id, chunk);
  chunks = [...unique.values()].slice(0, 12);
  let sources: ConversationSource[] = chunks.map((chunk) => ({
    id: chunk.id, source_type: "project_document", title: chunk.filename,
    locator: chunk.metadata?.label || chunk.metadata?.locator || "原文片段（暂无页码）",
    content: chunk.content.slice(0, 1800),
  }));
  if (!sources.length && documents.some((document) => document.parse_status === "done")) {
    // Old documents may predate chunk indexing. Preserve their genuine source map.
    const legacy = await query<{ id: string; filename: string; extracted_text: string; source_map: unknown }>(
      `SELECT id, filename, LEFT(extracted_text, 100000) AS extracted_text, source_map
       FROM documents WHERE project_id = $1 AND parse_status = 'done' ORDER BY created_at DESC LIMIT 12`, [projectId]);
    sources = legacy.flatMap((document) => {
      const map = normalizeSourceMap(document.source_map);
      return (map.length ? chunkLocatedText(map) : chunkText(document.extracted_text ?? ""))
        .map((chunk) => ({
          id: `${document.id}:${chunk.chunkIndex}`, source_type: "project_document",
          title: document.filename, locator: chunk.metadata.label || chunk.metadata.locator || "原文片段（暂无页码）",
          content: chunk.content.slice(0, 1800),
        }));
    }).sort((a, b) => relevance(b.content, terms) - relevance(a.content, terms)).slice(0, 10);
  }
  for (const report of reports) {
    const excerpts = chunkText(report.content).sort((a, b) => relevance(b.content, terms) - relevance(a.content, terms)).slice(0, 2);
    for (const excerpt of excerpts) sources.push({
      id: report.id, title: "已有项目报告（分析观点，需回查原始证据）", source_type: "project_report",
      content: excerpt.content.slice(0, 1800), href: `/reports/${report.id}`,
    });
  }
  return {
    name: project.name,
    sources,
    context: [
      `当前关联项目：${project.name}；行业：${project.industry || "未填写"}；阶段：${project.stage || "未填写"}；状态：${project.status}`,
      `项目材料：${documents.length ? documents.map((d) => `${d.filename}（${d.parse_status === "done" ? "已解析" : "尚未解析完成"}）`).join("；") : "暂无材料"}`,
      sources.length ? "下方是本轮检索到的相关片段，不代表已逐页核验全部材料。" : "本轮未取得可引用的项目原文，请明确说明资料缺口。",
      ...judgments.map((j) => `用户已有判断（不等于事实）：看好 ${j.bull_case || "未填"}；顾虑 ${j.bear_case || "未填"}；假设 ${j.key_hypothesis || "未填"}`),
    ].join("\n"),
  };
}
