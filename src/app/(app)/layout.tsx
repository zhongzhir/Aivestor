import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// 应用主外壳：侧栏 + 顶栏。
// 未登录访客（公开落地页 / 及 /help、/demo 等）不渲染外壳，直接返回纯净内容；
// 已登录用户（受 middleware 保护的页面必有 session）保持原有侧栏 + 顶栏布局。
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-canvas">{children}</main>
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
