import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import { QuotaBatchPanel } from "@/components/admin/QuotaBatchPanel";

export const dynamic = "force-dynamic";

interface Row {
  user_id: string;
  email: string | null;
  name: string;
  tokens_used: string;
  tokens_limit: string;
}

export default async function AdminQuotaPage() {
  await requireAdmin();

  const rows = await query<Row>(
    `SELECT q.user_id, u.email, u.name,
            q.tokens_used::text AS tokens_used,
            q.tokens_limit::text AS tokens_limit
       FROM free_quota_usage q
       JOIN users u ON u.id = q.user_id
   ORDER BY q.tokens_used DESC`
  );

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-gray-900">额度管理</h1>
      <p className="mt-1 text-sm text-gray-500">
        所有已有 free_quota_usage 记录的用户，按已用 tokens 降序。可勾选批量调整上限。
      </p>

      <div className="mt-6">
        <QuotaBatchPanel
          rows={rows.map((r) => ({
            userId: r.user_id,
            email: r.email,
            name: r.name,
            tokensUsed: Number(r.tokens_used),
            tokensLimit: Number(r.tokens_limit),
          }))}
        />
      </div>
    </div>
  );
}
