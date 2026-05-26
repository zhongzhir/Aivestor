import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { BriefAnalysisClient } from "@/components/project/BriefAnalysisClient";

export const dynamic = "force-dynamic";

// 简要分析页：原则性框架评估，无 3 条判断门槛。
export default async function BriefAnalysisPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();
  const rows = await query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (rows.length === 0) notFound();

  return (
    <BriefAnalysisClient projectId={params.id} projectName={rows[0].name} />
  );
}
