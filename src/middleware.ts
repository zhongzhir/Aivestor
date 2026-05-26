import { withAuth } from "next-auth/middleware";

// 保护需登录访问的路由；未登录用户重定向到 /login。
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/chat/:path*",
    "/projects/:path*",
    "/knowledge/:path*",
    "/archive/:path*",
    "/settings/:path*",
    "/cognition/:path*", // 保留入口；导航已移除，但鉴权仍生效
    // /skills 不在鉴权列表中（SKILL 广场公开页，未登录可浏览官方框架）
    // /help 不在鉴权列表中（产品介绍页可未登录访问）
  ],
};
