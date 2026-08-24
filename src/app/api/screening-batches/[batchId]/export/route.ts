import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";

const LABEL: Record<string, string> = { continue: "建议继续了解", more_info: "需要补充信息", not_priority: "暂不优先" };

export async function GET(_req: Request, { params }: { params: { batchId: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const batches = await query<{ name: string }>("SELECT name FROM screening_batches WHERE id=$1 AND user_id=$2", [params.batchId, session.user.id]);
  if (!batches[0]) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  const items = await query<{ name: string; status: string; result: Record<string, unknown> | null; error: string | null; promoted_project_id: string | null }>(
    "SELECT name,status,result,error,promoted_project_id FROM screening_items WHERE batch_id=$1 AND user_id=$2 ORDER BY created_at",
    [params.batchId, session.user.id]
  );
  const rows = items.map((item) => {
    const r = item.result || {};
    const join = (v: unknown) => Array.isArray(v) ? v.join("；") : "";
    return {
      项目名称: item.name,
      处理状态: item.status === "completed" ? "已完成" : item.status === "failed" ? "失败" : "处理中",
      AI初筛结论: LABEL[String(r.disposition)] || "",
      一句话判断: String(r.summary || ""),
      值得关注: join(r.strengths),
      主要风险: join(r.risks),
      待补信息: join(r.missing_information),
      筛选要求匹配: String(r.criteria_fit || ""),
      材料置信度: String(r.confidence || ""),
      已转为正式项目: item.promoted_project_id ? "是" : "否",
      错误信息: item.error || "",
    };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "初筛结果");
  const out = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(`${batches[0].name}-初筛结果.xlsx`);
  return new NextResponse(new Uint8Array(out), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "Cache-Control": "no-store",
  }});
}
