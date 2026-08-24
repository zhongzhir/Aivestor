import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseFile } from "@/lib/fileParser";
import { hasValidDocumentSignature, readFileBuffer } from "@/lib/fileStorage";

export const maxDuration = 120;
const TYPES = new Set(["pdf", "docx"]);

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const batches = await query<{ status: string }>("SELECT status FROM screening_batches WHERE id = $1 AND user_id = $2", [params.batchId, session.user.id]);
  if (!batches[0]) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  if (batches[0].status !== "draft") return NextResponse.json({ error: "初筛已开始，不能继续添加材料" }, { status: 409 });
  const body = await req.json().catch(() => ({})) as { fileUrl?: string; filename?: string; fileType?: string; fileSize?: number };
  if (!body.fileUrl || !body.filename || !body.fileType || !TYPES.has(body.fileType)) {
    return NextResponse.json({ error: "小版本仅支持 PDF、DOCX" }, { status: 400 });
  }
  const count = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM screening_items WHERE batch_id = $1", [params.batchId]);
  if ((count[0]?.count || 0) >= 20) return NextResponse.json({ error: "单批最多 20 个项目" }, { status: 400 });
  try {
    const buffer = await readFileBuffer(body.fileUrl);
    if (!hasValidDocumentSignature(buffer, body.fileType)) return NextResponse.json({ error: "文件内容与扩展名不匹配" }, { status: 422 });
    const parsed = await parseFile(buffer, body.fileType, body.filename);
    if (!parsed.text.trim()) return NextResponse.json({ error: "未能提取到可用文字" }, { status: 422 });
    const itemName = body.filename.replace(/\.(pdf|docx)$/i, "").trim() || body.filename;
    const rows = await query<{ id: string }>(
      `INSERT INTO screening_items (batch_id,user_id,name,filename,file_type,file_url,file_size,extracted_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [params.batchId, session.user.id, itemName, body.filename, body.fileType, body.fileUrl, body.fileSize || buffer.length, parsed.text]
    );
    return NextResponse.json({ id: rows[0].id, name: itemName, warning: parsed.warning }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "材料解析失败" }, { status: 422 });
  }
}
