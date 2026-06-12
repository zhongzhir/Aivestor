import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ProjectDetail } from "@/components/project/ProjectDetail";
import type { Judgment } from "@/components/project/StageProgress";
import type { FinancialData } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  judgment_points: string[];
  financial_data: FinancialData | null;
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

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();

  const projects = await query<ProjectRow>(
    `SELECT id, name, judgment_points, financial_data
       FROM projects WHERE id = $1 AND user_id = $2`,
    [params.id, session.user.id]
  );
  if (projects.length === 0) notFound();
  const project = projects[0];

  // process_stage 与 investment_judgments 新字段来自迁移 004。
  // 迁移可能尚未应用（或仅部分应用），此处容错处理以免整页 500。
  let processStage = "screening";
  try {
    const stageRows = await query<{ process_stage: string | null }>(
      "SELECT process_stage FROM projects WHERE id = $1",
      [params.id]
    );
    processStage = stageRows[0]?.process_stage ?? "screening";
  } catch (e) {
    console.error("[project] process_stage 读取失败，使用默认值:", e);
  }

  // outcome 字段来自迁移 008，同样容错处理。
  let outcome: string | null = null;
  let outcomeNote: string | null = null;
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
  } catch (e) {
    console.error("[project] outcome 读取失败，使用默认值:", e);
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

  const latest = await query<{ id: string }>(
    "SELECT id FROM reports WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 1",
    [params.id]
  );

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
      latestReportId={latest[0]?.id ?? null}
      initialFinancialData={project.financial_data}
    />
  );
}
