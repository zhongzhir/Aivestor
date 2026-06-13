import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/orgAuth";
import { AssocReportClient } from "@/components/org/AssocReportClient";

export const dynamic = "force-dynamic";

// 协会报告辅助（架构 7.4）：admin 且能力位 assoc_report；否则整页不可达。
export default async function AssocReportPage() {
  const ctx = await requireOrg("admin");
  if (ctx.capabilities["assoc_report"] !== true) redirect("/dashboard");

  return <AssocReportClient />;
}
