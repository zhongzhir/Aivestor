import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/adminAuth";
import { query } from "@/lib/db";
import { QuotaAdjuster } from "@/components/admin/QuotaAdjuster";

export const dynamic = "force-dynamic";

interface User {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  plan: string;
  auth_provider: string;
  onboarding_completed: boolean | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  stage: string | null;
  process_stage: string | null;
  created_at: string;
}

interface QuotaLog {
  tokens_in: number;
  tokens_out: number;
  feature: string | null;
  created_at: string;
}

interface Quota {
  tokens_used: string;
  tokens_limit: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();

  const userRows = await query<User>(
    `SELECT id, email, name, phone, plan, auth_provider, onboarding_completed, created_at
       FROM users WHERE id = $1`,
    [params.id]
  );
  const user = userRows[0];
  if (!user) notFound();

  const [projects, logs, quotaRows] = await Promise.all([
    query<Project>(
      `SELECT id, name, stage, process_stage, created_at
         FROM projects WHERE user_id = $1
        ORDER BY created_at DESC`,
      [params.id]
    ),
    query<QuotaLog>(
      `SELECT tokens_in, tokens_out, feature, created_at
         FROM free_quota_logs WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 20`,
      [params.id]
    ),
    query<Quota>(
      `SELECT tokens_used::text AS tokens_used, tokens_limit::text AS tokens_limit
         FROM free_quota_usage WHERE user_id = $1`,
      [params.id]
    ),
  ]);

  const quota = quotaRows[0];
  const tokensUsed = quota ? Number(quota.tokens_used) : null;
  const tokensLimit = quota ? Number(quota.tokens_limit) : null;

  return (
    <div className="p-8">
      <div className="mb-4">
        <Link
          href="/admin/users"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 返回用户列表
        </Link>
      </div>

      <h1 className="text-xl font-semibold text-gray-900">{user.name}</h1>
      <div className="mt-1 text-sm text-gray-500">{user.email ?? "(无邮箱)"}</div>

      {/* 基本信息 */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          基本信息
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <Item label="用户 ID" value={user.id} mono />
          <Item label="手机号" value={user.phone ?? "—"} />
          <Item label="Plan" value={user.plan} />
          <Item label="注册时间" value={new Date(user.created_at).toLocaleString("zh-CN")} />
          <Item label="登录方式" value={user.auth_provider} />
          <Item
            label="Onboarding"
            value={user.onboarding_completed ? "已完成" : "未完成"}
          />
        </dl>
      </section>

      {/* 额度 */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          免费额度
        </h2>
        <div className="flex items-end gap-6">
          <div>
            <div className="text-xs text-gray-500">已用 / 上限</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {fmt(tokensUsed)} / {fmt(tokensLimit)}
            </div>
          </div>
          <QuotaAdjuster userId={user.id} currentLimit={tokensLimit ?? 0} />
        </div>
        {!quota && (
          <p className="mt-3 text-xs text-gray-400">
            该用户尚无 free_quota_usage 记录（首次使用 AI 时自动创建）。
          </p>
        )}
      </section>

      {/* 项目列表 */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          项目（{projects.length}）
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-400">无项目</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1 font-medium">项目名</th>
                <th className="py-1 font-medium">融资轮次</th>
                <th className="py-1 font-medium">流程阶段</th>
                <th className="py-1 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 text-gray-900">{p.name}</td>
                  <td className="py-1.5 text-gray-500">{p.stage ?? "—"}</td>
                  <td className="py-1.5 text-gray-500">{p.process_stage ?? "—"}</td>
                  <td className="py-1.5 text-gray-500">
                    {new Date(p.created_at).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 额度日志 */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          额度日志（最近 20 条）
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">无消耗记录</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1 font-medium">时间</th>
                <th className="py-1 font-medium">功能</th>
                <th className="py-1 text-right font-medium">in</th>
                <th className="py-1 text-right font-medium">out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l, i) => (
                <tr key={i}>
                  <td className="py-1.5 text-gray-500">
                    {new Date(l.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="py-1.5 text-gray-500">{l.feature ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(l.tokens_in)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(l.tokens_out)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Item({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd
        className={
          mono
            ? "mt-0.5 font-mono text-[11px] text-gray-700"
            : "mt-0.5 text-gray-900"
        }
      >
        {value}
      </dd>
    </div>
  );
}
