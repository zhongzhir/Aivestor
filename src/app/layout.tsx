import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { BRAND } from "@/lib/brand";

// 仅自托管 Inter（拉丁/数字）。中文用系统字体栈（见 globals.css），
// 因为 next/font 的 Noto Sans SC 只暴露 latin 子集，中文字形无法可靠自托管。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: BRAND.productName,
    template: `%s | ${BRAND.shortProductName}`,
  },
  description: `面向一级股权投资人的${BRAND.shortProductName}，连接项目管线、材料分析、投资决策、投后管理与知识沉淀。`,
  keywords: [
    "投资分析",
    "AI工具",
    "风险投资",
    "私募股权",
    "BP分析",
    "尽职调查",
    "投委会",
    "投后管理",
    "知识库",
    "venture capital",
    "AI investment",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: BRAND.shortProductName,
    statusBarStyle: "default",
  },
  icons: {
    icon: BRAND.assets.favicon,
    apple: BRAND.assets.appleTouchIcon,
  },
  openGraph: {
    title: BRAND.productName,
    description: "从项目初筛、尽调和投资决策，到投后管理与报告输出，让材料、判断和行动在一个工作区持续沉淀。",
    url: BRAND.website,
    siteName: BRAND.shortProductName,
    locale: "zh_CN",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: BRAND.colors.deep,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" style={{
      "--brand-deep": BRAND.colors.deep,
      "--brand-primary": BRAND.colors.primary,
      "--brand-accent": BRAND.colors.accent,
      "--brand-surface": BRAND.colors.surface,
      "--brand-surface-strong": BRAND.profile === "zhongjian-zhitou" ? "#EAF2FB" : "#f4f1ea",
      "--brand-primary-soft": BRAND.profile === "zhongjian-zhitou" ? "#EAF2FB" : "#edf4ef",
    } as CSSProperties}>
      <body
        className={inter.variable}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
