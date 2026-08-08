import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrgContext } from "@/lib/orgAuth";
import { AppShell } from "@/components/AppShell";
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

  const userId = (session.user as { id?: string }).id;
  const orgContext = userId ? await getOrgContext(userId) : null;

  return (
    <>
      <AppShell hasOrganization={!!orgContext}>{children}</AppShell>
      <ServiceWorkerRegister />
    </>
  );
}
