import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/orgAuth";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/EmptyState";
import { ALL_STAGES } from "@/lib/stages";
import { OrgArchiveFilters } from "./OrgArchiveFilters";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  industry: string | null;
  stage: string | null;
  status: string;
  owner_name: string | null;
  updated_at: string;
  file_count: number;
  report_count: number;
}

const STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
};
const ALLOWED_STATUS = new Set(Object.keys(STATUS_LABEL));

// 机构档案管理（架构 7.1）：org 范围的项目档案统一视图，按阶段/状态/owner 浏览。
// 定位为管理层视图：requireOrg("partner") + 能力位 org_dashboard。
// 个人版/无能力位用户：requireOrg 重定向 + 能力位校验，整页不可达。
export default async function OrgArchivePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrg("partner");
  if (ctx.capabilities["org_dashboard"] !== true) redirect("/dashboard");

  const pick = (v: string | string[] | undefined) =>
    typeof v === "string" ? v.trim() : "";
  const search = pick(searchParams?.search);
  const ownerRaw = pick(searchParams?.owner);
  const stageRaw = pick(searchParams?.process_stage);
  const statusRaw = pick(searchParams?.status);

  const processStage =
    stageRaw && (ALL_STAGES as readonly string[]).includes(stageRaw)
      ? stageRaw
      : "";
  const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "";

  // 基线：本组织全部项目（管理层可见全部，故纯 org_id 过滤）。
  const where: string[] = ["p.org_id = $1"];
  const params: unknown[] = [ctx.orgId];

  if (search) {
    params.push(`%${search}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }
  if (ownerRaw) {
    params.push(ownerRaw);
    where.push(`p.owner_id = $${params.length}`);
  }
  if (processStage) {
    params.push(processStage);
    where.push(`p.process_stage = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }

  let projects: ProjectRow[] = [];
  let owners: { id: string; name: string }[] = [];
  try {
    [projects, owners] = await Promise.all([
      query<ProjectRow>(
        `SELECT p.id, p.name, p.industry, p.stage, p.status, p.updated_at,
                u.name AS owner_name,
                (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS file_count,
                (SELECT COUNT(*)::int FROM reports r WHERE r.project_id = p.id) AS report_count
           FROM projects p
           LEFT JOIN users u ON u.id = p.owner_id
          WHERE ${where.join(" AND ")}
          ORDER BY p.updated_at DESC`,
        params
      ),
      query<{ id: string; name: string }>(
        `SELECT u.id, u.name
           FROM org_members m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1
          ORDER BY u.name ASC`,
        [ctx.orgId]
      ),
    ]);
  } catch (e) {
    console.error("[org/archive] 数据读取失败:", e);
  }

  const hasFilters = Boolean(search || ownerRaw || processStage || status);

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">机构档案</h1>
      <p className="mt-1 text-sm text-ink-soft">
        组织内全部项目的统一视图 · 共 {projects.length} 个项目
      </p>

      <OrgArchiveFilters owners={owners} />

      {projects.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={hasFilters ? "🔍" : "🗂️"}
            title={hasFilters ? "没有匹配的项目" : "组织还没有项目"}
            description={
              hasFilters
                ? "试着调整搜索词或筛选条件"
                : "成员创建或转入组织项目后会汇集到这里"
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/archive/${p.id}`}
              className="card-base card-hover block p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="line-clamp-1 flex-1 text-sm font-medium text-slate-800">
                  {p.name}
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {p.industry || "未分类"}
                {p.stage && ` · ${p.stage}`}
                {p.owner_name && ` · 负责人 ${p.owner_name}`}
              </p>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span>📎 {p.file_count} 个文件</span>
                <span>📄 {p.report_count} 份报告</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                更新于 {new Date(p.updated_at).toLocaleDateString("zh-CN")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
