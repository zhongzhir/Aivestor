import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { loadUserAICredentials } from "@/lib/report";
import { REPORT_CONTEXT_DOC_KINDS } from "@/lib/report";
import { buildDeepResearchMessages, type DeepResearchMaterial, type DeepResearchProfile } from "@/lib/deepResearch";
import { buildDeepResearchMetadata, type EvidenceLedgerItem } from "@/lib/deepResearchWorkpaper";
import { runProjectExternalResearch, type DeepResearchExternalResult } from "@/lib/deepResearchExternal";
import { buildDueDiligenceTasks } from "@/lib/deepResearchTasks";
import { normalizeSourceMap } from "@/lib/sourceMap";
import { buildAccessScope } from "@/lib/resourceAccess";
import { injectProfile } from "@/lib/user-profile";
import { injectMarketContext, injectOrgKnowledge } from "@/lib/orgInject";
import type { FinancialData } from "@/lib/types";
import { buildDeepResearchQuantitativeAnalysis } from "@/lib/deepResearchQuantitative";

export type DeepResearchJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type DeepResearchJobPhase = "queued" | "external_research" | "report_generation" | "quality_gate" | "task_creation" | "completed" | "failed";

export interface DeepResearchJobRow {
  id: string;
  project_id: string;
  user_id: string;
  org_id: string | null;
  report_id: string | null;
  status: DeepResearchJobStatus;
  phase: DeepResearchJobPhase;
  progress: number;
  requested_profile: DeepResearchProfile;
  decision_context: string | null;
  source_cutoff_date: string | null;
  result: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
}

interface ProjectRow {
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  financial_data: FinancialData | null;
  judgment_points: string[] | null;
}

interface DocumentRow {
  filename: string;
  doc_kind: string;
  extracted_text: string;
  source_map: unknown;
}

function jobErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/SEARCH_FAILED|search.*failed/i.test(message)) return "external_search_failed";
  if (/FINALIZATION|INVALID_JSON/i.test(message)) return "research_output_invalid";
  if (/credential|API Key|配置.*Key/i.test(message)) return "credentials_unavailable";
  if (/timeout|abort/i.test(message)) return "timeout";
  return "job_failed";
}

async function updateJob(
  id: string,
  phase: DeepResearchJobPhase,
  progress: number
) {
  await query(
    `UPDATE deep_research_jobs
        SET phase = $1, progress = $2, locked_at = NOW(), updated_at = NOW()
      WHERE id = $3`,
    [phase, progress, id]
  );
}

export async function claimNextDeepResearchJob(): Promise<DeepResearchJobRow | null> {
  const rows = await query<DeepResearchJobRow>(
    `WITH candidate AS (
       SELECT id FROM deep_research_jobs
        WHERE (
          status = 'queued'
          OR (status = 'running' AND locked_at < NOW() - INTERVAL '20 minutes')
        )
          AND attempt_count < max_attempts
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE deep_research_jobs j
        SET status = 'running', phase = 'external_research', progress = 5,
            attempt_count = attempt_count + 1, locked_at = NOW(),
            started_at = COALESCE(started_at, NOW()), error_code = NULL,
            error_message = NULL, updated_at = NOW()
       FROM candidate
      WHERE j.id = candidate.id
     RETURNING j.*`
  );
  return rows[0] ?? null;
}

async function createTasks(input: {
  job: DeepResearchJobRow;
  reportId: string;
  ledger: EvidenceLedgerItem[];
  external: DeepResearchExternalResult;
}) {
  const tasks = buildDueDiligenceTasks(input.ledger, input.external);
  for (const task of tasks) {
    await query(
      `INSERT INTO deep_research_tasks
         (project_id, job_id, report_id, user_id, org_id, evidence_item_id,
          title, details, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (job_id, evidence_item_id) DO UPDATE SET
         title = EXCLUDED.title, details = EXCLUDED.details,
         priority = EXCLUDED.priority, updated_at = NOW()`,
      [
        input.job.project_id,
        input.job.id,
        input.reportId,
        input.job.user_id,
        input.job.org_id,
        task.evidenceItemId,
        task.title,
        task.details,
        task.priority,
      ]
    );
  }
  const firstP0 = tasks.find((task) => task.priority === "P0") ?? tasks[0];
  if (firstP0) {
    await query(
      `UPDATE projects
          SET next_action = CASE WHEN COALESCE(BTRIM(next_action), '') = '' THEN $1 ELSE next_action END,
              updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL`,
      [firstP0.title, input.job.project_id]
    );
  }
  return tasks.length;
}

export async function runClaimedDeepResearchJob(job: DeepResearchJobRow): Promise<void> {
  try {
    const projects = await query<ProjectRow>(
      `SELECT name, company_name, industry, stage, financial_data, judgment_points
         FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [job.project_id]
    );
    if (!projects[0]) throw new Error("项目不存在");
    const project = projects[0];
    const credentials = await loadUserAICredentials(job.user_id);
    if (!credentials) throw new Error("AI credentials unavailable");
    await updateJob(job.id, "external_research", 10);
    const external = await runProjectExternalResearch({
      credentials,
      projectName: project.name,
      companyName: project.company_name,
      industry: project.industry,
      stage: project.stage,
      judgmentPoints: project.judgment_points ?? [],
      decisionContext: job.decision_context,
      sourceCutoffDate: job.source_cutoff_date,
    });

    await updateJob(job.id, "report_generation", 55);
    const docs = await query<DocumentRow>(
      `SELECT filename, doc_kind, extracted_text, source_map FROM documents
        WHERE project_id = $1 AND extracted_text IS NOT NULL
          AND doc_kind = ANY($2::text[])
        ORDER BY created_at ASC`,
      [job.project_id, REPORT_CONTEXT_DOC_KINDS]
    );
    if (docs.length === 0) throw new Error("该项目尚未上传可解析材料");
    const generation = buildDeepResearchMessages({
      projectName: project.name,
      companyName: project.company_name,
      industry: project.industry,
      stage: project.stage,
      requestedProfile: job.requested_profile,
      judgmentPoints: project.judgment_points ?? [],
      decisionContext: job.decision_context,
      sourceCutoffDate: job.source_cutoff_date,
      materials: docs.map<DeepResearchMaterial>((doc) => ({
        filename: doc.filename,
        docKind: doc.doc_kind,
        extractedText: doc.extracted_text,
        sourceMap: doc.source_map,
      })),
      financialData: project.financial_data,
      externalResearch: external,
      quantitativeAnalysis: buildDeepResearchQuantitativeAnalysis({
        financialData: project.financial_data,
        decisionContext: job.decision_context,
      }),
    });
    const scope = await buildAccessScope(job.user_id);
    const retrievalQuery = [project.name, project.company_name, project.industry, ...(project.judgment_points ?? [])]
      .filter(Boolean)
      .join(" ");
    let system = await injectProfile(job.user_id, generation.system, {
      projectName: project.name,
      companyName: project.company_name,
      industry: project.industry,
      stage: project.stage,
      projectJudgments: project.judgment_points ?? [],
      taskText: "后台项目级深度投研：外部取证、证据底稿、质量门禁和尽调任务",
    });
    system = await injectOrgKnowledge(scope, retrievalQuery, system);
    system = await injectMarketContext(scope, retrievalQuery, system);
    let content = "";
    for await (const chunk of streamChat({
      provider: credentials.provider,
      apiKey: credentials.apiKey,
      baseURL: credentials.baseURL,
      model: credentials.model,
      system,
      messages: generation.messages,
    })) {
      content += chunk;
      if (content.length > 180_000) throw new Error("深度投研报告超过长度限制");
    }
    if (!content.trim()) throw new Error("深度投研报告为空");

    await updateJob(job.id, "quality_gate", 85);
    const validCitations = [
      ...docs.flatMap((doc, documentIndex) =>
        normalizeSourceMap(doc.source_map).map((entry) => `M${documentIndex + 1}·${entry.locator}`)
      ),
      ...external.findings.map((_, index) => `E${index + 1}`),
    ];
    const quantitativeAnalysis = buildDeepResearchQuantitativeAnalysis({
      financialData: project.financial_data,
      decisionContext: job.decision_context,
    });
    const metadata = buildDeepResearchMetadata({
      content,
      profile: generation.resolvedProfile,
      validCitations,
      quantitativeAnalysis,
    });
    const title = `${project.name} · 深度投研报告`;
    let reportId = job.report_id;
    if (reportId) {
      const updated = await query<{ id: string }>(
        `UPDATE reports
            SET title = $1, content = $2, status = 'draft', kind = 'deep_research',
                org_id = $3, research_metadata = $4
          WHERE id = $5 AND project_id = $6 AND user_id = $7
          RETURNING id`,
        [title, content, job.org_id, JSON.stringify(metadata), reportId, job.project_id, job.user_id]
      );
      if (!updated[0]) reportId = null;
    }
    if (!reportId) {
      const reports = await query<{ id: string }>(
        `INSERT INTO reports
           (project_id, user_id, title, content, status, kind, org_id, research_metadata)
         VALUES ($1,$2,$3,$4,'draft','deep_research',$5,$6)
         RETURNING id`,
        [job.project_id, job.user_id, title, content, job.org_id, JSON.stringify(metadata)]
      );
      reportId = reports[0].id;
    }

    await query(
      `UPDATE deep_research_jobs
          SET phase = 'task_creation', progress = 95, report_id = $1,
              result = $2, locked_at = NOW(), updated_at = NOW()
        WHERE id = $3`,
      [reportId, JSON.stringify({ externalResearch: external, gate: metadata.gate }), job.id]
    );
    const taskCount = await createTasks({
      job,
      reportId,
      ledger: metadata.evidenceLedger,
      external,
    });
    await query(
      `UPDATE deep_research_jobs
          SET status = 'completed', phase = 'completed', progress = 100,
              report_id = $1, result = $2, completed_at = NOW(),
              locked_at = NULL, updated_at = NOW()
        WHERE id = $3`,
      [reportId, JSON.stringify({ externalResearch: external, gate: metadata.gate, taskCount }), job.id]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE deep_research_jobs
          SET status = 'failed', phase = 'failed', progress = LEAST(progress, 99),
              error_code = $1, error_message = $2, locked_at = NULL,
              updated_at = NOW()
        WHERE id = $3`,
      [jobErrorCode(error), message.slice(0, 2_000), job.id]
    );
    throw error;
  }
}

export async function processNextDeepResearchJob(): Promise<string | null> {
  const job = await claimNextDeepResearchJob();
  if (!job) return null;
  await runClaimedDeepResearchJob(job);
  return job.id;
}
