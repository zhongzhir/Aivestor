import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// 保护需登录访问的路由；未登录用户重定向到 /login。
// 对 /admin/*：在 Edge 层用 JWT token.plan 做快路径校验，非 admin → 302 /dashboard。
// （服务端 layout / API 内部还会用 adminAuth.ts 从 DB 现取再校验一次。）
export default withAuth(
  function middleware(req) {
    if (req.nextUrl.pathname.startsWith("/admin")) {
      const plan = (req.nextauth.token as { plan?: string } | null)?.plan;
      if (plan !== "admin") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
    // 对 /org/* 与 /data-apps/*：JWT token.orgId 存在性做快路径拦截
    // （无组织 → 302 /dashboard）。能力位（data_apps / zjjr_data）不在 Edge 判
    // （拿不到可靠数据），由服务端页面 / API 用 orgAuth.ts 从 DB 现取校验。
    const isIntelligenceSubscriptionRoute =
      req.nextUrl.pathname === "/data-apps/intelligence-subscriptions" ||
      req.nextUrl.pathname.startsWith("/data-apps/intelligence-subscriptions/");
    if (
      req.nextUrl.pathname.startsWith("/org") ||
      (req.nextUrl.pathname.startsWith("/data-apps") &&
        !isIntelligenceSubscriptionRoute)
    ) {
      const orgId = (req.nextauth.token as { orgId?: string } | null)?.orgId;
      if (!orgId) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/chat/:path*",
    "/projects/:path*",
    "/knowledge/:path*",
    "/archive/:path*",
    "/settings/:path*",
    "/cognition/:path*", // 保留入口；导航已移除，但鉴权仍生效
    "/admin/:path*",
    "/org/:path*",
    "/data-apps/:path*",
    // /skills 不在鉴权列表中（SKILL 广场公开页，未登录可浏览官方框架）
    // /help 不在鉴权列表中（产品介绍页可未登录访问）
  ],
};
