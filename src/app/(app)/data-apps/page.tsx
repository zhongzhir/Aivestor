import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getOrgContext } from "@/lib/orgAuth";
import { DATA_APPS } from "@/lib/dataApps";

export const dynamic = "force-dynamic";

// 数据应用列表页（架构 6.1）：requireOrg + data_apps 能力位守门；
// 逐个按 requiredCapability 过滤决定可点击/置灰。
export default async function DataAppsPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const ctx = await getOrgContext(session.user.id);
  if (!ctx && !DATA_APPS.some((app) => app.availableToPersonal)) redirect("/dashboard");
  if (ctx && ctx.capabilities["data_apps"] !== true && !DATA_APPS.some((app) => app.availableToPersonal)) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">数据应用</h1>
      <p className="mt-1 text-sm text-ink-soft">
        基于中鉴基金研究院数据的研究辅助应用
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {DATA_APPS.map((app) => {
          const enabled = app.availableToPersonal === true || !!ctx?.capabilities[app.requiredCapability ?? ""];
          if (!enabled) {
            return (
              <div
                key={app.id}
                className="rounded-lg border border-line bg-surface px-4 py-4 opacity-60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{app.icon}</span>
                  <span className="text-sm font-medium text-ink-soft">
                    {app.name}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-faint">{app.description}</p>
                <p className="mt-2 text-xs text-ink-faint">机构数据能力暂未开通</p>
              </div>
            );
          }
          return (
            <Link
              key={app.id}
              href={`/data-apps/${app.id}`}
              className="rounded-lg border border-line bg-white px-4 py-4 transition-colors hover:border-[#0D1B3E]"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{app.icon}</span>
                <span className="text-sm font-medium text-ink">{app.name}</span>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">{app.description}</p>
              <span className="mt-2 inline-block text-sm text-accent">
                进入 →
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
