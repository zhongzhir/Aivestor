import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireOrg } from "@/lib/orgAuth";
import { getDataApp } from "@/lib/dataApps";

export const dynamic = "force-dynamic";

// 数据应用动态路由（架构 6.1）：按 appId 查注册表，requireOrg + 该应用
// requiredCapability 守门，动态加载对应组件渲染。
export default async function DataAppPage({
  params,
}: {
  params: { appId: string };
}) {
  const app = getDataApp(params.appId);
  if (!app) notFound();

  // 服务端守门：未开通该应用所需能力位 → 回 /dashboard（与 requireCapabilityAPI 同款）。
  const ctx = await requireOrg();
  if (ctx.capabilities[app.requiredCapability] !== true) redirect("/dashboard");

  // 动态加载客户端组件（路径静态可分析；mod.default 为 "use client" 组件）。
  const mod = await app.component();
  const AppComponent = mod.default;

  return (
    <div className="mx-auto max-w-doc px-6 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Link href="/data-apps" className="text-ink-faint hover:text-ink">
          数据应用
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-ink">
          {app.icon} {app.name}
        </span>
      </div>
      <AppComponent />
    </div>
  );
}
