import { redirect } from "next/navigation";

// 导航整合后，组织设置内容并入「组织工作台 · 成员与设置」。旧路由重定向，避免 404。
export default function OrgSettingsRedirect() {
  redirect("/org/workspace?tab=members");
}
