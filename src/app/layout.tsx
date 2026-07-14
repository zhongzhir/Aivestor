import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

// 仅自托管 Inter（拉丁/数字）。中文用系统字体栈（见 globals.css），
// 因为 next/font 的 Noto Sans SC 只暴露 latin 子集，中文字形无法可靠自托管。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aivestor — 股权投资全周期 AI 工作台",
    template: "%s | Aivestor",
  },
  description:
    "面向一级股权投资人的全周期工作台，连接项目管线、材料分析、投资决策、IC Memo、投后管理与知识沉淀。",
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
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Aivestor",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Aivestor — 股权投资全周期 AI 工作台",
    description: "从项目初筛、尽调和投资决策，到投后管理与报告输出，让材料、判断和行动在一个工作区持续沉淀。",
    url: "https://aivestor.cn",
    siteName: "Aivestor",
    locale: "zh_CN",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0D1B3E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body
        className={inter.variable}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
