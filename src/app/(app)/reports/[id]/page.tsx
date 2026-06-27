// 独立报告查看页：用于无关联项目的竞争格局等分析报告。
// URL: /reports/[id]
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildAccessScope } from "@/lib/resourceAccess";
import { StandaloneReportView } from "@/components/report/StandaloneReportView";

export const dynamic = "force-dynamic";

interface ReportRow {
  id: string;
  title: string;
  content: string;
  kind: string;
  status: string;
  org_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export default async function StandaloneReportPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();
  const scope = await buildAccessScope(session.user.id);

  // 权限：本人创建 OR 同一 org 成员（org_id 匹配）
  const orgId = scope.org?.orgId ?? null;
  const reports = await query<ReportRow>(
    `SELECT id, title, content, kind, status, org_id, user_id,
            created_at, updated_at
       FROM reports
      WHERE id = $1
        AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3))`,
    [params.id, session.user.id, orgId]
  );
  if (reports.length === 0) notFound();

  const report = reports[0];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/archive"
          className="text-xs text-ink-faint hover:text-ink"
        >
          ← 返回档案
        </Link>
        <span className="text-xs text-ink-faint">/</span>
        <span className="text-xs text-ink-faint truncate">{report.title}</span>
      </div>

      <StandaloneReportView
        reportId={report.id}
        title={report.title}
        content={report.content}
        kind={report.kind}
        updatedAt={report.updated_at}
      />
    </div>
  );
}
