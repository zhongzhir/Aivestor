import Link from "next/link";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { sleepDays } from "@/lib/projectSleep";
import { BRAND } from "@/lib/brand";
import { getGenerationAccess } from "@/lib/intelligenceGeneration";
import { IntelligenceAttention, type DashboardIntelligenceBrief, type DashboardIntelligenceItem, type DashboardIntelligenceTask } from "@/components/dashboard/IntelligenceAttention";

const QUICK_ACTIONS = [
  {
    href: "/projects/new",
    label: "新项目",
    title: "整理一份新材料",
    desc: "上传 BP、财务模型或补充材料，形成项目工作区。",
  },
  {
    href: "/chat",
    label: "研究",
    title: "讨论一个问题",
    desc: "把赛道、公司或判断点先放进一次可沉淀的讨论。",
  },
  {
    href: "/knowledge",
    label: "知识",
    title: "回看已有判断",
    desc: "从历史项目、报告和手工笔记里找可复用的经验。",
  },
];

const STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
  active: "进行中",
  archived: "已归档",
};

interface RecentProject {
  id: string;
  name: string;
  company_name: string | null;
  industry: string | null;
  status: string;
  process_stage: string | null;
  updated_at: string;
  latest_report_id: string | null;
  latest_report_status: string | null;
}

interface CountRow {
  count: string;
}

interface IntelligenceTaskRow {
  id: string;
  name: string;
  is_active: boolean;
  execution_mode: "manual" | "scheduled";
  schedule_config: DashboardIntelligenceTask["scheduleConfig"];
}

interface IntelligenceBriefRow {
  id: string;
  task_id: string;
  task_name: string;
  generated_at: string;
  important_facts: unknown;
  trend_signals: unknown;
  other_items: unknown;
  metadata: unknown;
}

type AttentionProject = RecentProject & { days: number };

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const hour = 3_600_000;
  const day = 24 * hour;
  if (Number.isNaN(diff)) return "最近";
  if (diff < hour) return "刚刚";
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;

  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function gentlePeriod(days: number): string {
  if (days < 21) return "2 周前";
  if (days < 35) return "3 周前";
  if (days < 56) return "1 个多月前";
  return `${Math.round(days / 30)} 个月前`;
}

function projectMeta(project: RecentProject): string {
  return [project.company_name, project.industry, project.process_stage]
    .filter(Boolean)
    .join(" · ");
}

function briefItems(row: IntelligenceBriefRow): DashboardIntelligenceItem[] {
  return [row.important_facts, row.trend_signals, row.other_items]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((item): item is DashboardIntelligenceItem => typeof item === "object" && item !== null)
    .slice(0, 12);
}

function briefOverview(row: IntelligenceBriefRow): string {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  return typeof metadata.overview === "string" ? metadata.overview.replace(/^#{1,3}\s+/, "").trim() : "";
}

async function safeCount(sql: string, params: unknown[]): Promise<number> {
  try {
    const rows = await query<CountRow>(sql, params);
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  const user = session?.user;

  const recentProjects = user
    ? await query<RecentProject>(
        `SELECT p.id, p.name, p.company_name, p.industry, p.status,
                p.process_stage, p.updated_at,
                r.id AS latest_report_id, r.status AS latest_report_status
           FROM projects p
           LEFT JOIN LATERAL (
             SELECT id, status FROM reports
              WHERE project_id = p.id
              ORDER BY updated_at DESC LIMIT 1
           ) r ON true
          WHERE p.user_id = $1 AND p.deleted_at IS NULL
          ORDER BY p.updated_at DESC
          LIMIT 6`,
        [user.id]
      ).catch(() => [])
    : [];

  let attentionProjects: AttentionProject[] = [];
  if (user) {
    const rows = await query<RecentProject>(
      `SELECT p.id, p.name, p.company_name, p.industry, p.status,
              p.process_stage, p.updated_at,
              NULL::uuid AS latest_report_id, NULL::text AS latest_report_status
         FROM projects p
        WHERE p.user_id = $1 AND p.deleted_at IS NULL
          AND p.status IN ('evaluating', 'invested')
        ORDER BY p.updated_at ASC`,
      [user.id]
    ).catch(() => []);

    attentionProjects = rows
      .map((p) => ({ ...p, days: sleepDays(p.status, p.updated_at) }))
      .filter((p): p is AttentionProject => p.days !== null)
      .slice(0, 4);
  }

  const [activeCount, knowledgeCount, draftReportCount] = user
    ? await Promise.all([
        safeCount(
          "SELECT COUNT(*)::text AS count FROM projects WHERE user_id = $1 AND deleted_at IS NULL AND status IN ('evaluating', 'invested')",
          [user.id]
        ),
        safeCount(
          "SELECT COUNT(*)::text AS count FROM knowledge_base_entries WHERE user_id = $1",
          [user.id]
        ),
        safeCount(
          `SELECT COUNT(*)::text AS count
             FROM reports r
             JOIN projects p ON p.id = r.project_id
            WHERE p.user_id = $1 AND p.deleted_at IS NULL AND r.status = 'draft'`,
          [user.id]
        ),
      ])
    : [0, 0, 0];

  let intelligenceTasks: DashboardIntelligenceTask[] = [];
  let latestIntelligenceBriefs: DashboardIntelligenceBrief[] = [];
  let intelligenceQuotaUnavailable = false;
  if (user) {
    try {
      const taskRows = await query<IntelligenceTaskRow>(
        "SELECT id, name, is_active, execution_mode, schedule_config FROM intelligence_tasks WHERE user_id = $1 ORDER BY updated_at DESC",
        [user.id]
      );
      intelligenceTasks = taskRows.map((task) => ({ id: task.id, name: task.name, isActive: task.is_active, executionMode: task.execution_mode, scheduleConfig: task.schedule_config }));
      if (intelligenceTasks.length > 0) {
        const taskIds = intelligenceTasks.map((task) => task.id);
        const briefRows = await query<IntelligenceBriefRow>(
          `SELECT DISTINCT ON (task_id) id, task_id, task_name, generated_at, important_facts, trend_signals, other_items, metadata
             FROM intelligence_briefs
            WHERE user_id = $1 AND task_id = ANY($2::uuid[])
            ORDER BY task_id, generated_at DESC`,
          [user.id, taskIds]
        );
        latestIntelligenceBriefs = briefRows.map((latest) => ({
          id: latest.id,
          taskId: latest.task_id,
          taskName: latest.task_name,
          generatedAt: latest.generated_at,
          overview: briefOverview(latest),
          items: briefItems(latest),
        }));
        intelligenceQuotaUnavailable = intelligenceTasks.some((task) => task.isActive) && !(await getGenerationAccess(user.id));
      }
    } catch {
      intelligenceTasks = [];
    }
  }

  let showOnboarding = false;
  if (user) {
    try {
      const rows = await query<{
        onboarding_completed: boolean | null;
        api_key_encrypted: string | null;
      }>(
        "SELECT onboarding_completed, api_key_encrypted FROM users WHERE id = $1",
        [user.id]
      );
      const row = rows[0];
      const completed = !!row?.onboarding_completed;
      const hasApiKey = !!row?.api_key_encrypted;
      showOnboarding = !completed && recentProjects.length === 0 && !hasApiKey;
    } catch {
      showOnboarding = false;
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <OnboardingGate show={showOnboarding} />

      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-[#e6ded1] bg-[#fffdfa] p-6 shadow-[0_1px_2px_rgba(55,53,47,0.04)]">
          <p className="text-sm text-ink-soft">
            {user ? `${user.name}，早上好` : `欢迎来到 ${BRAND.productName}`}
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-ink">
                今天想推进什么
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-soft">
                项目、材料、判断和知识都在同一张桌面上。从活跃项目、报告草稿和知识开始今天的工作。
              </p>
            </div>
            <Link
              href="/projects/new"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:opacity-90"
            >
              新建项目分析
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <MetricCard label="活跃项目" value={activeCount} note="正在推进或投后跟踪" />
            <MetricCard label="知识条目" value={knowledgeCount} note="可被检索和复用" />
            <MetricCard label="报告草稿" value={draftReportCount} note="可继续打磨输出" />
          </div>
        </div>

        <div className="rounded-lg border border-[#e6ded1] bg-[#f7f2e8] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">今日关注</h2>
            <span className="rounded-full bg-white/70 px-2 py-1 text-xs text-ink-soft">
              项目与情报
            </span>
          </div>
          {attentionProjects.length === 0 ? (
            <p className="mt-5 text-sm leading-7 text-ink-soft">
              暂时没有需要特别回看的项目。你可以从最近项目继续，或者整理一份新材料。
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {attentionProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block rounded-lg border border-[#e2d8c8] bg-white/70 p-3 transition-colors hover:border-[#cdbfAA] hover:bg-white"
                >
                  <p className="text-sm font-medium text-ink">{project.name}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-soft">
                    你在{gentlePeriod(project.days)}关注的项目，有新进展吗？
                  </p>
                </Link>
              ))}
            </div>
          )}
          {user && <IntelligenceAttention tasks={intelligenceTasks} briefs={latestIntelligenceBriefs} quotaUnavailable={intelligenceQuotaUnavailable} />}
        </div>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">快速开始</h2>
            <span className="text-xs text-ink-faint">常用动作</span>
          </div>
          <div className="mt-4 space-y-3">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-line p-3 transition-colors hover:border-[#b7c8bc] hover:bg-[#f7fbf8]"
              >
                <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-accent-soft px-2 text-xs font-medium text-accent">
                  {action.label}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">
                    {action.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-ink-soft">
                    {action.desc}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">最近项目</h2>
            <Link href="/projects" className="text-xs font-medium text-accent">
              查看项目管线
            </Link>
          </div>

          {recentProjects.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-line bg-surface/60 p-6 text-center">
              <p className="text-sm font-medium text-ink">还没有项目</p>
              <p className="mt-2 text-sm text-ink-soft">
                创建第一个项目后，工作台会开始整理材料、判断和后续动作。
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-line">
              {recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="grid gap-2 py-3 transition-colors hover:bg-[#fbfaf7] sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {project.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-soft">
                      {projectMeta(project) || "等待补充公司、赛道或阶段信息"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-soft">
                    <span className="rounded-full bg-surface px-2 py-1">
                      {STATUS_LABEL[project.status] ?? project.status}
                    </span>
                    <span>{relativeTime(project.updated_at)}</span>
                    <span className="font-medium text-accent">继续</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
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
