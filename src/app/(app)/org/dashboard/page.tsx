import { redirect } from "next/navigation";

// 导航整合后，机构 Dashboard 内容并入「组织工作台 · 概览」。旧路由重定向，避免 404。
export default function OrgDashboardRedirect() {
  redirect("/org/workspace?tab=overview");
}
