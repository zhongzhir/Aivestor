import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import Footer from "@/components/Footer";

// 应用主外壳：侧栏 + 顶栏 + 底脚（含 ICP 备案）。
// 未登录访客（公开落地页 / 及 /help、/demo 等）渲染极简外壳：内容 + Footer；
// 已登录用户（受 middleware 保护的页面必有 session）保持侧栏 + 顶栏，
// 并在 main 下方挂载 Footer（钉在视口底部，ICP 始终可见）。
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-canvas">{children}</main>
        <Footer />
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
