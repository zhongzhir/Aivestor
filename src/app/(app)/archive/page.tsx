import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getOrgContext } from "@/lib/orgAuth";
import { EmptyState } from "@/components/ui/EmptyState";
import { ArchiveFilters } from "./ArchiveFilters";
import { OrgArchiveFilters } from "../org/archive/OrgArchiveFilters";
import { ArchiveViewSwitch } from "@/components/archive/ArchiveViewSwitch";
import { ArchiveProjectActions } from "@/components/archive/ArchiveProjectActions";
import { ALL_STAGES } from "@/lib/stages";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  industry: string | null;
  stage: string | null;
  status: string;
  updated_at: string;
  owner_name?: string | null;
  file_count: number;
  report_count: number;
  user_id: string;
  org_id: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
};

const ALLOWED_OUTCOMES = new Set([
  "pending",
  "invested",
  "passed",
  "exited_profit",
  "exited_loss",
]);
const ALLOWED_STATUS = new Set(["evaluating", "invested", "passed", "exited"]);

const pickStr = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim() : "";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireAuth();

  // 机构档案视图（与 P4 /org/archive 同口径）的可见性：org 管理层 + 统计能力位。
  // 个人版/analyst/未开通能力位：无视图切换，行为与现状完全一致。
  const ctx = await getOrgContext(session.user.id);
  const canOrgView =
    !!ctx &&
    (ctx.role === "partner" || ctx.role === "admin") &&
    ctx.capabilities["org_dashboard"] === true;

  const view: "personal" | "org" =
    pickStr(searchParams?.view) === "org" && canOrgView ? "org" : "personal";

  // ---- 机构档案视图（org 范围）----
  if (view === "org" && ctx) {
    const search = pickStr(searchParams?.search);
    const ownerRaw = pickStr(searchParams?.owner);
    const stageRaw = pickStr(searchParams?.process_stage);
    const statusRaw = pickStr(searchParams?.status);
    const processStage =
      stageRaw && (ALL_STAGES as readonly string[]).includes(stageRaw)
        ? stageRaw
        : "";
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "";

    const where: string[] = ["p.org_id = $1", "p.deleted_at IS NULL"];
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
                  p.user_id, p.org_id,
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
      console.error("[archive][org] 数据读取失败:", e);
    }

    const hasFilters = Boolean(search || ownerRaw || processStage || status);

    return (
      <div className="mx-auto max-w-doc px-6 py-10">
        <h1 className="text-xl font-semibold text-ink">项目档案</h1>
        <p className="mt-1 text-sm text-ink-soft">
          机构档案 · 组织内全部项目 · 共 {projects.length} 个
        </p>

        <ArchiveViewSwitch view={view} />
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
              <ArchiveCard
                key={p.id}
                p={p}
                showOwner
                canDelete={ctx.role === "admin"}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- 项目档案视图（个人可见范围，与现状一致）----
  const search = pickStr(searchParams?.search);
  const processStageRaw = pickStr(searchParams?.process_stage);
  const outcomeRaw = pickStr(searchParams?.outcome);
  const sort = pickStr(searchParams?.sort) || "updated_desc";

  const processStage =
    processStageRaw && (ALL_STAGES as readonly string[]).includes(processStageRaw)
      ? processStageRaw
      : "";
  const outcome = outcomeRaw && ALLOWED_OUTCOMES.has(outcomeRaw) ? outcomeRaw : "";

  const where: string[] = ["p.user_id = $1", "p.deleted_at IS NULL"];
  const params: unknown[] = [session.user.id];

  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR p.judgment_points::text ILIKE $${params.length})`
    );
  }
  if (processStage) {
    params.push(processStage);
    where.push(`p.process_stage = $${params.length}`);
  }
  if (outcome) {
    params.push(outcome);
    where.push(`p.outcome = $${params.length}`);
  }

  const orderBy =
    sort === "created_desc" ? "p.created_at DESC" : "p.updated_at DESC";

  let projects: ProjectRow[] = [];
  try {
    projects = await query<ProjectRow>(
      `SELECT p.id, p.name, p.industry, p.stage, p.status, p.updated_at,
              p.user_id, p.org_id,
              (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS file_count,
              (SELECT COUNT(*)::int FROM reports r WHERE r.project_id = p.id) AS report_count
         FROM projects p
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}`,
      params
    );
  } catch (e) {
    console.error("[archive] 数据读取失败:", e);
  }

  const hasFilters = Boolean(
    search || processStage || outcome || sort !== "updated_desc"
  );

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      <h1 className="text-xl font-semibold text-ink">项目档案</h1>
      <p className="mt-1 text-sm text-ink-soft">每个项目的完整生命周期记录</p>

      {canOrgView && <ArchiveViewSwitch view={view} />}
      <ArchiveFilters />

      {projects.length === 0 ? (
        <div className="mt-6">
          {hasFilters ? (
            <EmptyState
              icon="🔍"
              title="没有匹配的档案"
              description="试着调整搜索词或筛选条件"
            />
          ) : (
            <EmptyState
              icon="🗂️"
              title="还没有项目档案"
              description="创建项目后，所有文件、报告、判断与跟踪都会汇集到这里"
              action={{ label: "新建项目分析", href: "/projects/new" }}
            />
          )}
        </div>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ArchiveCard
              key={p.id}
              p={p}
              canDelete={
                p.org_id === null ||
                (!!ctx && ctx.orgId === p.org_id && ctx.role === "admin")
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveCard({
  p,
  showOwner,
  canDelete,
}: {
  p: ProjectRow;
  showOwner?: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="card-base card-hover flex items-start gap-2 p-4">
      <Link href={`/archive/${p.id}`} className="min-w-0 flex-1">
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
          {showOwner && p.owner_name && ` · 负责人 ${p.owner_name}`}
        </p>
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          <span>📎 {p.file_count} 个文件</span>
          <span>📄 {p.report_count} 份报告</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          更新于 {new Date(p.updated_at).toLocaleDateString("zh-CN")}
        </p>
      </Link>
      {canDelete && (
        <ArchiveProjectActions projectId={p.id} projectName={p.name} />
      )}
    </div>
  );
}
