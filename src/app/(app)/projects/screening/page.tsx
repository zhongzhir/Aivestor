import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ScreeningPage() {
  const session = await requireAuth();
  const batches = await query<{ id:string; name:string; criteria:string|null; status:string; created_at:string; item_count:number; completed_count:number }>(
    `SELECT b.id,b.name,b.criteria,b.status,b.created_at,COUNT(i.id)::int item_count,
            COUNT(i.id) FILTER (WHERE i.status='completed')::int completed_count
       FROM screening_batches b LEFT JOIN screening_items i ON i.batch_id=b.id
      WHERE b.user_id=$1 GROUP BY b.id ORDER BY b.created_at DESC`, [session.user.id]
  );
  const status: Record<string,string> = { draft:"待开始", processing:"分析中", completed:"已完成", completed_with_errors:"部分失败" };
  return <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-8">
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-white p-6 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm text-ink-soft">项目管线</p><h1 className="mt-2 text-2xl font-semibold text-ink">批量项目初筛</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">一次提交多份项目材料，分别完成基础初筛。候选项目不会自动进入正式项目库。</p></div>
      <Link href="/projects/screening/new" className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white">新建批量初筛</Link>
    </div>
    <div className="mt-6 overflow-hidden rounded-lg border border-line bg-white">
      {batches.length===0 ? <div className="p-10 text-center text-sm text-ink-soft">还没有批量初筛任务</div> : <div className="divide-y divide-line">{batches.map(b=><Link key={b.id} href={`/projects/screening/${b.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-surface">
        <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{b.name}</p><p className="mt-1 truncate text-xs text-ink-soft">{b.criteria || "未填写筛选要求，由 AI 自主初筛"}</p></div>
        <div className="shrink-0 text-right"><p className="text-sm text-ink">{status[b.status] || b.status}</p><p className="mt-1 text-xs text-ink-faint">{b.completed_count}/{b.item_count} 个完成</p></div>
      </Link>)}</div>}
    </div>
  </div>;
}
