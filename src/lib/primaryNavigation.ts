export type PrimaryNavigationItem = {
  href: string;
  label: string;
  desc: string;
};

export const DESKTOP_PRIMARY_NAV: PrimaryNavigationItem[] = [
  { href: "/dashboard", label: "工作台", desc: "今日关注" },
  { href: "/chat", label: "研究对话", desc: "讨论与沉淀" },
  { href: "/projects", label: "项目管线", desc: "分析与推进" },
  {
    href: "/data-apps/intelligence-subscriptions",
    label: "投资情报",
    desc: "主题、运行与历史简报",
  },
  { href: "/archive", label: "项目档案", desc: "历史与投后" },
  { href: "/knowledge", label: "知识库", desc: "经验复用" },
  { href: "/skills", label: "SKILL 广场", desc: "分析框架" },
  { href: "/settings", label: "设置", desc: "偏好与账户" },
];

export const MOBILE_PRIMARY_NAV: PrimaryNavigationItem[] = [
  { href: "/dashboard", label: "工作台", desc: "今日" },
  { href: "/projects", label: "项目", desc: "管线" },
  {
    href: "/data-apps/intelligence-subscriptions",
    label: "情报",
    desc: "发现",
  },
  { href: "/settings", label: "我的", desc: "设置" },
];

export function isPrimaryNavigationActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/" || pathname.startsWith("/dashboard");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
