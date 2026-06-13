import { redirect } from "next/navigation";

// 导航整合后，机构档案并入「项目档案」的视图切换。旧路由重定向，避免 404。
export default function OrgArchiveRedirect() {
  redirect("/archive?view=org");
}
