import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ProjectDetail } from "@/components/project/ProjectDetail";
import type { Judgment } from "@/components/project/StageProgress";
import type { FinancialData } from "@/lib/types";
import {
  buildAccessScope,
  assertProjectAccess,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  judgment_points: string[];
  financial_data: FinancialData | null;
  org_id: string | null;
  owner_id: string | null;
  created_at: string;
}

interface DocRow {
  id: string;
  filename: string;
  chars: number;
  extracted_text: string | null;
  file_type: string;
  doc_kind: string;
  parse_status: string;
  created_at: string;
}

interface ReportRow {
  id: string;
  title: string;
  status: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

interface MeetingRow {
  id: string;
  title: string;
  meeting_date: string | null;
  meeting_type: string;
  created_at: string;
}

interface UpdateRow {
  id: string;
  update_type: string;
  period: string | null;
  created_at: string;
}

interface WorkflowRow {
  next_action: string | null;
  next_action_due_at: string | null;
  evidence_completeness: number | null;
  workspace_note: string | null;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();

  // 访问校验：个人项目仅本人；组织项目按角色/共享可见（与 API 同一规则）。
  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch {
    notFound();
  }

  const projects = await query<ProjectRow>(
    `SELECT id, name, judgment_points, financial_data, org_id, owner_id, created_at
       FROM projects WHERE id = $1`,
    [params.id]
  );
  if (projects.length === 0) notFound();
  const project = projects[0];
  const isOrgProject = !!project.org_id;

  // process_stage 与 investment_judgments 新字段来自迁移 004。
  // 迁移可能尚未应用（或仅部分应用），此处容错处理以免整页 500。
  let processStage = "screening";
  let processStageUpdatedAt: string | null = null;
  try {
    const stageRows = await query<{
      process_stage: string | null;
      process_stage_updated_at: string | null;
    }>(
      "SELECT process_stage, process_stage_updated_at FROM projects WHERE id = $1",
      [params.id]
    );
    processStage = stageRows[0]?.process_stage ?? "screening";
    processStageUpdatedAt = stageRows[0]?.process_stage_updated_at ?? null;
  } catch (e) {
    console.error("[project] process_stage 读取失败，使用默认值:", e);
  }

  // outcome 字段来自迁移 008，同样容错处理。
  let outcome: string | null = null;
  let outcomeNote: string | null = null;
  let outcomeAt: string | null = null;
  try {
    const outcomeRows = await query<{
      outcome: string | null;
      outcome_note: string | null;
      outcome_at: string | null;
    }>(
      "SELECT outcome, outcome_note, outcome_at FROM projects WHERE id = $1",
      [params.id]
    );
    outcome = outcomeRows[0]?.outcome ?? null;
    outcomeNote = outcomeRows[0]?.outcome_note ?? null;
    outcomeAt = outcomeRows[0]?.outcome_at ?? null;
  } catch (e) {
    console.error("[project] outcome 读取失败，使用默认值:", e);
  }

  let workflow: WorkflowRow = {
    next_action: null,
    next_action_due_at: null,
    evidence_completeness: null,
    workspace_note: null,
  };
  try {
    const workflowRows = await query<WorkflowRow>(
      `SELECT next_action, next_action_due_at, evidence_completeness, workspace_note
         FROM projects WHERE id = $1`,
      [params.id]
    );
    workflow = workflowRows[0] ?? workflow;
  } catch (e) {
    console.error("[project] workflow 字段读取失败，使用默认值:", e);
  }

  let judgments: Judgment[] = [];
  try {
    judgments = await query<Judgment>(
      `SELECT id, stage, bull_case, bear_case, founder_assessment,
              key_hypothesis, confidence_level, created_at
         FROM investment_judgments
        WHERE project_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [params.id, session.user.id]
    );
  } catch (e) {
    console.error("[project] 判断记录读取失败，使用空列表:", e);
  }

  const docs = await query<DocRow>(
    `SELECT id, filename,
            COALESCE(char_length(extracted_text), 0) AS chars,
            extracted_text, file_type, doc_kind, parse_status, created_at
       FROM documents
      WHERE project_id = $1
      ORDER BY created_at ASC`,
    [params.id]
  );

  const bpText = docs
    .map((d) => d.extracted_text)
    .filter(Boolean)
    .join("\n\n---\n\n");

  let reports: ReportRow[] = [];
  try {
    const reportScope = scopedProjectChildWhere(scope, 2, {
      alias: "r",
      excludeMergedForAnalyst: true,
    });
    reports = await query<ReportRow>(
      `SELECT r.id, r.title, r.status, r.kind, r.created_at, r.updated_at
         FROM reports r
        WHERE r.project_id = $1 AND ${reportScope.sql}
        ORDER BY r.updated_at DESC
        LIMIT 8`,
      [params.id, ...reportScope.params]
    );
  } catch (e) {
    console.error("[project] 报告动态读取失败，使用空列表:", e);
  }

  let meetings: MeetingRow[] = [];
  try {
    const meetingScope = scopedProjectChildWhere(scope, 2, { alias: "m" });
    meetings = await query<MeetingRow>(
      `SELECT m.id, m.title, m.meeting_date, m.meeting_type, m.created_at
         FROM meeting_notes m
        WHERE m.project_id = $1 AND ${meetingScope.sql}
        ORDER BY m.meeting_date DESC NULLS LAST, m.created_at DESC
        LIMIT 8`,
      [params.id, ...meetingScope.params]
    );
  } catch (e) {
    console.error("[project] 会议动态读取失败，使用空列表:", e);
  }

  let updates: UpdateRow[] = [];
  try {
    const updateScope = scopedProjectChildWhere(scope, 2, { alias: "u" });
    updates = await query<UpdateRow>(
      `SELECT u.id, u.update_type, u.period, u.created_at
         FROM post_investment_updates u
        WHERE u.project_id = $1 AND ${updateScope.sql}
        ORDER BY u.created_at DESC
        LIMIT 8`,
      [params.id, ...updateScope.params]
    );
  } catch (e) {
    console.error("[project] 投后动态读取失败，使用空列表:", e);
  }

  return (
    <ProjectDetail
      projectId={project.id}
      projectName={project.name}
      processStage={processStage}
      outcome={outcome}
      outcomeNote={outcomeNote}
      judgments={judgments}
      bpText={bpText}
      docMeta={docs.map((d) => ({
        id: d.id,
        filename: d.filename,
        chars: d.chars,
        fileType: d.file_type,
        docKind: d.doc_kind,
        parseStatus: d.parse_status,
        uploadedAt: d.created_at,
      }))}
      initialPoints={
        Array.isArray(project.judgment_points) ? project.judgment_points : []
      }
      latestReportId={reports[0]?.id ?? null}
      reports={reports}
      meetings={meetings}
      updates={updates}
      projectCreatedAt={project.created_at}
      processStageUpdatedAt={processStageUpdatedAt}
      outcomeAt={outcomeAt}
      workflow={{
        nextAction: workflow.next_action,
        nextActionDueAt: workflow.next_action_due_at,
        evidenceCompleteness: workflow.evidence_completeness,
        workspaceNote: workflow.workspace_note,
      }}
      initialFinancialData={project.financial_data}
      isOrgProject={isOrgProject}
      hasOrg={!!scope.org}
      currentUserId={session.user.id}
    />
  );
}
