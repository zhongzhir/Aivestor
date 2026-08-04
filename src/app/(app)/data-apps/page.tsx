import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getOrgContext } from "@/lib/orgAuth";
import { DATA_APPS } from "@/lib/dataApps";

export const dynamic = "force-dynamic";

// 数据应用列表页：只展示当前用户实际可访问的应用。
export default async function DataAppsPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const ctx = await getOrgContext(session.user.id);
  const accessibleApps = DATA_APPS.filter((app) => app.availableToPersonal === true || !!ctx?.capabilities[app.requiredCapability]);
  if (accessibleApps.length === 0) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">数据应用</h1>
      <p className="mt-1 text-sm text-ink-soft">
        基于中鉴基金研究院数据的研究辅助应用
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {accessibleApps.map((app) => (
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
          ))}
      </div>
    </div>
  );
}
