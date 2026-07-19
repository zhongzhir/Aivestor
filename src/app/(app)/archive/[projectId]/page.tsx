import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildAccessScope,
  assertProjectAccess,
  ResourceForbiddenError,
} from "@/lib/resourceAccess";
import {
  ArchiveTabs,
  type ArchiveDoc,
  type ArchiveReport,
  type ArchiveJudgment,
  type ArchiveOutcome,
} from "@/components/archive/ArchiveTabs";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  industry: string | null;
  stage: string | null;
  status: string;
}

export default async function ProjectArchivePage({
  params,
}: {
  params: { projectId: string };
}) {
  const session = await requireAuth();

  // 归属校验：个人项目仅创建者；组织项目按角色（partner/admin 全部，
  // analyst 仅 owner+共享）。个人版退化为"仅本人"，与原 user_id=$2 等价。
  const scope = await buildAccessScope(session.user.id);
  let isAnalyst = false;
  try {
    await assertProjectAccess(scope, params.projectId, "read");
    isAnalyst = scope.org?.role === "analyst";
  } catch (e) {
    if (e instanceof ResourceForbiddenError) notFound();
    throw e;
  }

  // 访问已校验，按 id 取项目字段即可。
  const projects = await query<ProjectRow>(
    `SELECT id, name, industry, stage, status FROM projects
      WHERE id = $1 AND deleted_at IS NULL`,
    [params.projectId]
  );
  if (projects.length === 0) notFound();
  const project = projects[0];

  // 容错读取：每张表读取失败都不阻塞主页面
  let docs: ArchiveDoc[] = [];
  let reports: ArchiveReport[] = [];
  let judgments: ArchiveJudgment[] = [];
  let outcome: ArchiveOutcome | null = null;

  try {
    docs = await query<ArchiveDoc>(
      `SELECT id, filename, file_type, doc_kind, parse_status, created_at
         FROM documents
        WHERE project_id = $1
        ORDER BY created_at DESC`,
      [params.projectId]
    );
  } catch (e) {
    console.error("[archive/[projectId]] documents 读取失败:", e);
  }

  try {
    // analyst 不可见投委会总报告（kind='committee'，含他人判断内容，见 1.2 矩阵）。
    reports = await query<ArchiveReport>(
      `SELECT id, title, version, status, updated_at
         FROM reports
        WHERE project_id = $1 ${isAnalyst ? "AND kind <> 'committee'" : ""}
        ORDER BY updated_at DESC`,
      [params.projectId]
    );
  } catch (e) {
    console.error("[archive/[projectId]] reports 读取失败:", e);
  }

  try {
    judgments = await query<ArchiveJudgment>(
      `SELECT id, stage, bull_case, bear_case, founder_assessment,
              key_hypothesis, confidence_level, created_at
         FROM investment_judgments
        WHERE project_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [params.projectId, session.user.id]
    );
  } catch (e) {
    console.error("[archive/[projectId]] judgments 读取失败:", e);
  }

  try {
    const outcomeRows = await query<ArchiveOutcome>(
      "SELECT outcome, outcome_note FROM projects WHERE id = $1 AND deleted_at IS NULL",
      [params.projectId]
    );
    if (outcomeRows[0]) outcome = outcomeRows[0];
  } catch (e) {
    console.error("[archive/[projectId]] outcome 读取失败:", e);
  }

  return (
    <div className="mx-auto max-w-doc px-6 py-10">
      {/* 面包屑 */}
      <div className="text-xs text-ink-faint">
        <Link href="/archive" className="hover:text-ink">
          项目档案
        </Link>
        <span className="mx-1">/</span>
        <span>{project.name}</span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {project.industry || "未分类"}
            {project.stage && ` · ${project.stage}`}
          </p>
        </div>
        <Link
          href={`/projects/${project.id}`}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50"
        >
          打开项目分析 →
        </Link>
      </div>

      <ArchiveTabs
        projectId={project.id}
        projectName={project.name}
        initialDocs={docs}
        reports={reports}
        judgments={judgments}
        outcome={outcome}
      />
    </div>
  );
}
