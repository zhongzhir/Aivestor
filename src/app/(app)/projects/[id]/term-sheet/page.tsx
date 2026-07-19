import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { TermSheetClient } from "@/components/project/TermSheetClient";

export const dynamic = "force-dynamic";

// Term Sheet 初稿生成页：基于项目信息生成投资条款清单初稿。
export default async function TermSheetPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();
  const rows = await query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [params.id, session.user.id]
  );
  if (rows.length === 0) notFound();

  return (
    <TermSheetClient projectId={params.id} projectName={rows[0].name} />
  );
}
