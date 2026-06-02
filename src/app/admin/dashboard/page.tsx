import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface CountRow {
  c: string;
}

async function getStats() {
  // 并发跑所有聚合查询
  const [
    totalUsers,
    todayNewUsers,
    last7dNewUsers,
    totalProjects,
    totalReports,
    totalKb,
    totalTokensUsed,
    activeUsers7d,
  ] = await Promise.all([
    query<CountRow>("SELECT COUNT(*)::text AS c FROM users"),
    query<CountRow>(
      "SELECT COUNT(*)::text AS c FROM users WHERE created_at >= date_trunc('day', NOW())"
    ),
    query<CountRow>(
      "SELECT COUNT(*)::text AS c FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
    ),
    query<CountRow>("SELECT COUNT(*)::text AS c FROM projects"),
    query<CountRow>("SELECT COUNT(*)::text AS c FROM reports"),
    query<CountRow>("SELECT COUNT(*)::text AS c FROM knowledge_base_entries"),
    query<CountRow>(
      "SELECT COALESCE(SUM(tokens_used), 0)::text AS c FROM free_quota_usage"
    ),
    query<CountRow>(
      `SELECT COUNT(DISTINCT user_id)::text AS c
         FROM free_quota_logs
        WHERE created_at > NOW() - INTERVAL '7 days'`
    ),
  ]);

  return {
    totalUsers: Number(totalUsers[0]?.c ?? 0),
    todayNewUsers: Number(todayNewUsers[0]?.c ?? 0),
    last7dNewUsers: Number(last7dNewUsers[0]?.c ?? 0),
    totalProjects: Number(totalProjects[0]?.c ?? 0),
    totalReports: Number(totalReports[0]?.c ?? 0),
    totalKb: Number(totalKb[0]?.c ?? 0),
    totalTokensUsed: Number(totalTokensUsed[0]?.c ?? 0),
    activeUsers7d: Number(activeUsers7d[0]?.c ?? 0),
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const s = await getStats();

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-gray-900">数据概览</h1>
      <p className="mt-1 text-sm text-gray-500">
        服务端直查；当前数据非缓存，刷新即更新。
      </p>

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          用户
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="总用户数" value={fmt(s.totalUsers)} />
          <Card label="今日新增" value={fmt(s.todayNewUsers)} />
          <Card label="7 日新增" value={fmt(s.last7dNewUsers)} />
          <Card
            label="7 日活跃"
            value={fmt(s.activeUsers7d)}
            hint="基于 free_quota_logs 去重"
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          内容
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card label="总项目数" value={fmt(s.totalProjects)} />
          <Card label="总报告数" value={fmt(s.totalReports)} />
          <Card label="知识库条目" value={fmt(s.totalKb)} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          免费额度消耗
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card
            label="累计 tokens"
            value={fmt(s.totalTokensUsed)}
            hint="SUM(tokens_used) FROM free_quota_usage"
          />
        </div>
      </section>
    </div>
  );
}
