import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";
import { processDocumentChunks } from "@/lib/documentChunks";

export async function POST(_req: Request, { params }: { params: { batchId: string; itemId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await buildAccessScope(session.user.id);
  const orgId = scope.org && await hasCapability(scope.org.orgId, "collaboration") ? scope.org.orgId : null;
  const created = await withTransaction(async (client) => {
    const locked = await client.query<{
      name: string; filename: string; file_type: string; file_url: string; file_size: number;
      extracted_text: string; promoted_project_id: string | null;
    }>(
      `SELECT i.name,i.filename,i.file_type,i.file_url,i.file_size,i.extracted_text,i.promoted_project_id
         FROM screening_items i JOIN screening_batches b ON b.id=i.batch_id
        WHERE i.id=$1 AND i.batch_id=$2 AND b.user_id=$3 AND i.status='completed' FOR UPDATE OF i`,
      [params.itemId, params.batchId, session.user.id]
    );
    const item = locked.rows[0];
    if (!item) return null;
    if (item.promoted_project_id) return { projectId: item.promoted_project_id, documentId: null, text: item.extracted_text, existing: true };
    const project = await client.query<{ id: string }>(
      `INSERT INTO projects (user_id,name,org_id,owner_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [session.user.id, item.name, orgId, orgId ? session.user.id : null]
    );
    const document = await client.query<{ id: string }>(
      `INSERT INTO documents (user_id,project_id,filename,file_type,file_url,file_size,doc_kind,extracted_text,parse_status,org_id)
       VALUES ($1,$2,$3,$4,$5,$6,'bp',$7,'done',$8) RETURNING id`,
      [session.user.id, project.rows[0].id, item.filename, item.file_type, item.file_url, item.file_size, item.extracted_text, orgId]
    );
    await client.query(
      `UPDATE screening_items SET promoted_project_id=$2 WHERE id=$1 AND promoted_project_id IS NULL`,
      [params.itemId, project.rows[0].id]
    );
    return { projectId: project.rows[0].id, documentId: document.rows[0].id, text: item.extracted_text, existing: false };
  });
  if (!created) return NextResponse.json({ error: "候选项目不存在或尚未完成" }, { status: 404 });
  if (created.documentId) {
    await processDocumentChunks(created.documentId, session.user.id, created.text).catch((error) => {
      console.error("[screening-promote] 文档切分失败:", error);
    });
  }
  return NextResponse.json({ id: created.projectId, existing: created.existing }, { status: created.existing ? 200 : 201 });
}
