import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/EmptyState";
import { sleepDays } from "@/lib/projectSleep";
import { ProjectFilters } from "./ProjectFilters";
import { ALL_STAGES, STAGE_LABELS } from "@/lib/stages";
import { buildAccessScope, scopedProjectWhere } from "@/lib/resourceAccess";
import { getProjectManagementOptions } from "@/lib/projectManagement";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  company_name: string | null;
  industry: string | null;
  status: string;
  stage: string | null;
  process_stage: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
  latest_report_id: string | null;
  latest_report_status: string | null;
  category_id: string | null;
  category_name: string | null;
  is_priority: boolean;
  tags: { id: string; name: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
  active: "进行中",
  archived: "已归档",
};

const OUTCOME_LABEL: Record<string, string> = {
  pending: "待定",
  invested: "已投",
  passed: "已 Pass",
  exited_profit: "盈利退出",
  exited_loss: "亏损退出",
};

const ALLOWED_OUTCOMES = new Set([
  "pending",
  "invested",
  "passed",
  "exited_profit",
  "exited_loss",
]);

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString("zh-CN");
}

function gentleFollowUp(days: number | null): string {
  if (days === null) return "保持当前节奏";
  if (days < 21) return "2 周前关注过";
  if (days < 35) return "3 周前关注过";
  if (days < 56) return "1 个多月前关注过";
  return `${Math.round(days / 30)} 个月前关注过`;
}

function projectMeta(project: ProjectRow): string {
  return [project.company_name, project.industry, project.stage]
    .filter(Boolean)
    .join(" · ");
}

function reportLabel(project: ProjectRow): string {
  if (!project.latest_report_id) return "尚无报告";
  return project.latest_report_status === "finalized" ? "报告已定稿" : "报告草稿";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireAuth();

  const pickStr = (v: string | string[] | undefined) =>
    typeof v === "string" ? v.trim() : "";
  const search = pickStr(searchParams?.search);
  const stage = pickStr(searchParams?.stage);
  const processStageRaw = pickStr(searchParams?.process_stage);
  const outcomeRaw = pickStr(searchParams?.outcome);
  const category = pickStr(searchParams?.category);
  const tag = pickStr(searchParams?.tag);
  const priority = pickStr(searchParams?.priority) === "1";
  const sort = pickStr(searchParams?.sort) || "created_desc";

  const processStage =
    processStageRaw &&
    (ALL_STAGES as readonly string[]).includes(processStageRaw)
      ? processStageRaw
      : "";
  const outcome = outcomeRaw && ALLOWED_OUTCOMES.has(outcomeRaw) ? outcomeRaw : "";

  const scope = await buildAccessScope(session.user.id);
  const scoped = scopedProjectWhere(scope, 1, { alias: "p" });
  const where: string[] = [scoped.sql];
  const params: unknown[] = [...scoped.params];

  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR p.company_name ILIKE $${params.length} OR p.industry ILIKE $${params.length} OR p.judgment_points::text ILIKE $${params.length})`
    );
  }
  if (stage) {
    params.push(stage);
    where.push(`p.stage = $${params.length}`);
  }
  if (processStage) {
    params.push(processStage);
    where.push(`p.process_stage = $${params.length}`);
  }
  if (outcome) {
    params.push(outcome);
    where.push(`p.outcome = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`p.category_id = $${params.length}`);
  }
  if (tag) {
    params.push(tag);
    where.push(`EXISTS (SELECT 1 FROM project_tag_links fl WHERE fl.project_id = p.id AND fl.tag_id = $${params.length})`);
  }
  if (priority) where.push("p.is_priority = true");

  const orderBy =
    sort === "priority_desc"
      ? "p.is_priority DESC, p.updated_at DESC"
      : sort === "updated_desc" ? "p.updated_at DESC" : "p.created_at DESC";

  const projects = await query<ProjectRow>(
    `SELECT p.id, p.name, p.company_name, p.industry, p.status,
            p.stage, p.process_stage, p.outcome,
            p.created_at, p.updated_at,
            p.category_id, c.name AS category_name, p.is_priority,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                        FROM project_tag_links l JOIN project_tags t ON t.id = l.tag_id
                       WHERE l.project_id = p.id), '[]'::json) AS tags,
            r.id AS latest_report_id, r.status AS latest_report_status
       FROM projects p
       LEFT JOIN project_categories c ON c.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM reports
          WHERE project_id = p.id
          ORDER BY updated_at DESC LIMIT 1
       ) r ON true
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}`,
    params
  );

  const stageRows = await query<{ stage: string }>(
    `SELECT DISTINCT p.stage FROM projects p WHERE ${scopedProjectWhere(scope, 1, { alias: "p" }).sql}
       AND p.stage IS NOT NULL AND p.stage <> ''
      ORDER BY p.stage`,
    scopedProjectWhere(scope, 1, { alias: "p" }).params
  );
  const stageOptions = stageRows.map((r) => r.stage);
  const options = await getProjectManagementOptions(scope);

  const activeCount = projects.filter((p) =>
    ["evaluating", "invested"].includes(p.status)
  ).length;
  const reviewCount = projects.filter(
    (p) => sleepDays(p.status, p.updated_at) !== null
  ).length;

  const hasFilters = Boolean(
    search || stage || processStage || outcome || category || tag || priority || sort !== "created_desc"
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <div className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-ink-soft">项目管线</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">
              把正在看的项目排成一张清晰的工作队列
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-soft">
              按阶段、报告状态和近期进展整理项目，方便你快速回到上次的判断现场。
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#2f6f4f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#265b42]"
          >
            新建项目
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <PipelineMetric label="当前列表" value={projects.length} note="按筛选条件显示" />
          <PipelineMetric label="活跃项目" value={activeCount} note="评估或投后跟踪" />
          <PipelineMetric label="近期线索" value={reviewCount} note="值得重新看一眼" />
        </div>
      </div>

      <ProjectFilters stageOptions={stageOptions} categories={options.categories} tags={options.tags} />

      {projects.length === 0 ? (
        <div className="mt-6">
          {hasFilters ? (
            <EmptyState
              icon="⌕"
              title="没有匹配的项目"
              description="可以调整搜索词、阶段或结论筛选。"
            />
          ) : (
            <>
              <EmptyState
                icon="▦"
                title="还没有项目"
                description="创建第一个项目，上传 BP 或补充材料后，项目会进入这张工作队列。"
                action={{ label: "新建项目分析", href: "/projects/new" }}
              />
              <DemoCards />
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-line bg-white">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_0.9fr_0.8fr_0.8fr_auto] gap-4 border-b border-line bg-surface px-4 py-3 text-xs font-medium text-ink-soft lg:grid">
            <span>项目</span>
            <span>阶段</span>
            <span>报告</span>
            <span>回看线索</span>
            <span className="text-right">动作</span>
          </div>
          <div className="divide-y divide-line">
            {projects.map((project) => {
              const days = sleepDays(project.status, project.updated_at);
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="grid grid-cols-1 gap-3 px-4 py-4 transition-colors hover:bg-[#fbfaf7] lg:grid-cols-[minmax(0,1.4fr)_0.9fr_0.8fr_0.8fr_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-base ${project.is_priority ? "text-amber-500" : "text-slate-300"}`} aria-label={project.is_priority ? "重点项目" : "非重点项目"}>★</span>
                      <span className="truncate text-sm font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">
                        {STATUS_LABEL[project.status] ?? project.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-soft">
                      {projectMeta(project) || "等待补充公司、赛道或融资阶段"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {project.category_name && <span className="rounded bg-[#eef5ef] px-1.5 py-0.5 text-[11px] text-[#2f6f4f]">{project.category_name}</span>}
                      {project.tags.slice(0, 3).map((t) => <span key={t.id} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft">{t.name}</span>)}
                      {project.tags.length > 3 && <span className="text-[11px] text-ink-faint">+{project.tags.length - 3}</span>}
                    </div>
                  </div>

                  <div className="text-xs text-ink-soft">
                    <span className="rounded-md border border-line bg-white px-2 py-1">
                      {project.process_stage
                        ? STAGE_LABELS[project.process_stage] ?? project.process_stage
                        : "待整理"}
                    </span>
                    <p className="mt-2 text-ink-faint">
                      {project.outcome && project.outcome !== "pending"
                        ? OUTCOME_LABEL[project.outcome] ?? project.outcome
                        : "结论待定"}
                    </p>
                  </div>

                  <div className="text-xs text-ink-soft">
                    <span>{reportLabel(project)}</span>
                    <p className="mt-2 text-ink-faint">
                      创建于 {formatDate(project.created_at)}
                    </p>
                  </div>

                  <div className="text-xs text-ink-soft">
                    <span>{gentleFollowUp(days)}</span>
                    <p className="mt-2 text-ink-faint">
                      最近更新 {formatDate(project.updated_at)}
                    </p>
                  </div>

                  <div className="text-right text-xs font-medium text-[#2f6f4f]">
                    打开工作区
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-[#ece4d8] bg-white/70 p-4">
      <div className="font-numeric text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-sm font-medium text-ink">{label}</div>
      <div className="mt-1 text-xs text-ink-soft">{note}</div>
    </div>
  );
}

function DemoCards() {
  const demos = [
    {
      href: "/demo/consumer",
      title: "野兽派茶（消费品牌）",
      desc: "新消费 · Pre-A · 2000 万",
    },
    {
      href: "/demo/saas",
      title: "DataSync Pro（企业 SaaS）",
      desc: "数据集成中间件 · A 轮 · 5000 万",
    },
  ];

  return (
    <div className="mt-6">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        示例项目 · 只读
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        无需登录即可浏览，了解 Aivestor 生成的项目报告形态。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {demos.map((demo) => (
          <Link
            key={demo.href}
            href={demo.href}
            className="card-base card-hover block p-4"
          >
            <p className="text-sm font-medium text-ink">{demo.title}</p>
            <p className="mt-1 text-xs text-ink-soft">{demo.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
