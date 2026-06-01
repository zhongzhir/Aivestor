import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import LandingPage from "@/components/LandingPage";

export default async function RootPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");
  // 本地化部署模式：跳过 SaaS 落地页（含 aivestor.cn 文案与备案中提示），
  // 直接进登录页。生产 SaaS 部署不设此变量，行为不变。
  if (process.env.NEXT_PUBLIC_LANDING_MODE === "local") redirect("/login");
  return <LandingPage />;
}
