import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasCapability } from "@/lib/orgAuth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// 应用主外壳：侧栏 + 顶栏。
// 未登录访客（公开落地页 / /help / /demo 等）不渲染外壳，直接返回纯净内容；
// 已登录用户（受 middleware 保护的页面必有 session）保持侧栏 + 顶栏布局。
//
// 备案信息（ICP / 公安备案）仅由 LandingPage 自己挂载 Footer 展示，
// 登录后的 app 内页面与登录页都不展示。
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return <>{children}</>;
  }

  // 「数据应用」导航入口的能力位守门（data_apps）。仅对有组织的用户查（与
  // 「组织工作台」入口一样以 session.user.orgId 为前置），hasCapability 走 30s 缓存。
  const orgId = (session.user as { orgId?: string } | undefined)?.orgId;
  const dataAppsEnabled = orgId
    ? await hasCapability(orgId, "data_apps").catch(() => false)
    : false;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar dataAppsEnabled={dataAppsEnabled} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-canvas">{children}</main>
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
