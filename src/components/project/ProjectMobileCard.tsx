import Link from "next/link";
import { sleepDays } from "@/lib/projectSleep";
import { STAGE_LABELS } from "@/lib/stages";

export interface ProjectMobileCardData {
  id: string;
  name: string;
  company_name: string | null;
  industry: string | null;
  status: string;
  stage: string | null;
  process_stage: string | null;
  outcome: string | null;
  updated_at: string;
  latest_report_id: string | null;
  latest_report_status: string | null;
  is_priority: boolean;
  next_action: string | null;
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

function projectMeta(project: ProjectMobileCardData): string {
  return [project.company_name, project.industry, project.stage]
    .filter(Boolean)
    .join(" · ");
}

function reportLabel(project: ProjectMobileCardData): string {
  if (!project.latest_report_id) return "尚无报告";
  return project.latest_report_status === "finalized" ? "报告已定稿" : "报告草稿";
}

export function ProjectMobileCard({
  project,
  focus,
  taskBrief = "",
}: {
  project: ProjectMobileCardData;
  focus?: string;
  taskBrief?: string;
}) {
  const days = sleepDays(project.status, project.updated_at);
  const href = focus === "ic"
    ? `/projects/${project.id}?tab=decision&focus=ic${taskBrief ? `&brief=${encodeURIComponent(taskBrief)}` : ""}`
    : `/projects/${project.id}`;
  const stage = project.process_stage
    ? STAGE_LABELS[project.process_stage] ?? project.process_stage
    : "待整理";
  const outcome = project.outcome && project.outcome !== "pending"
    ? OUTCOME_LABEL[project.outcome] ?? project.outcome
    : "结论待定";

  return (
    <Link
      href={href}
      className="block rounded-xl border border-line bg-white p-4 shadow-[0_1px_3px_rgba(55,53,47,0.04)] transition-colors hover:border-[#d6cdbf] hover:bg-[#fffdfa] focus:outline-none focus:ring-2 focus:ring-accent/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 text-sm ${project.is_priority ? "text-amber-500" : "text-slate-300"}`} aria-label={project.is_priority ? "重点项目" : "非重点项目"}>★</span>
            <h2 className="truncate text-base font-semibold text-ink">{project.name}</h2>
          </div>
          <p className="mt-1 truncate text-xs text-ink-soft">
            {projectMeta(project) || "等待补充公司、赛道或融资阶段"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-1 text-[11px] text-ink-soft">
          {STATUS_LABEL[project.status] ?? project.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md border border-line bg-[#fffdfa] px-2 py-1 text-ink">{stage}</span>
        <span className="rounded-md bg-surface px-2 py-1 text-ink-soft">{outcome}</span>
        <span className="text-ink-faint">{reportLabel(project)}</span>
      </div>

      <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2">
        <p className="text-[11px] font-medium text-accent">下一步</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ink">
          {project.next_action || (project.latest_report_id ? "回看报告并确认下一步" : "补充材料并形成第一版分析")}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-ink-faint">
        <span>{gentleFollowUp(days)}</span>
        <span>更新于 {formatDate(project.updated_at)} · 打开工作区</span>
      </div>
    </Link>
  );
}
