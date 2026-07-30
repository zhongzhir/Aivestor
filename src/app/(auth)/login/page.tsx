import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `登录 · ${BRAND.shortProductName}` };

export default function LoginPage() {
  // GitHub OAuth 为可选项：仅在已配置凭据时显示登录入口。
  const githubEnabled =
    !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET;

  return (
    <Suspense>
      <LoginForm githubEnabled={githubEnabled} />
    </Suspense>
  );
}
