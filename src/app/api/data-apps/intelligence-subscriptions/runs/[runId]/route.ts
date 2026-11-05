import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireIntelligenceAPI } from "@/lib/intelligenceAccess";
import { publicIntelligenceRun, retryIntelligenceRun } from "@/lib/intelligenceRuns";

export const dynamic = "force-dynamic";

function publicAttemptHistory(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const { worker: _internalWorker, ...safe } = entry as Record<string, unknown>;
    return safe;
  });
}

export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const rows = await query<Record<string, unknown>>(
    `SELECT r.id,r.task_id,r.trigger_type,r.status,r.config_version,r.config_snapshot,
            r.scheduled_for,r.coverage_start,r.coverage_end,r.attempt_count,r.attempt_history,
            r.started_at,r.finished_at,r.retrieval_status,r.provider_diagnostics,
            r.evidence_summary,r.usage,r.external_cost_authorization,r.error_code,r.error_message_safe,r.created_at,r.updated_at,
            b.id AS brief_id,
            (COALESCE((r.usage->>'freshExternalAuthorizationRequired')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekSearch')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekGeneration')::boolean,false)
              OR EXISTS (
                SELECT 1 FROM intelligence_run_external_attempts a
                 WHERE a.run_id=r.id AND a.user_id=r.user_id
              )) AS requires_fresh_authorization
       FROM intelligence_runs r
       LEFT JOIN intelligence_briefs b ON b.run_id=r.id AND b.user_id=r.user_id
      WHERE r.id=$1 AND r.user_id=$2`,
    [params.runId, guard.access.userId]
  );
  if (!rows[0]) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  const evidence = await query<Record<string, unknown>>(
    `SELECT item_key,canonical_url,source_name,source_tier,retrieval_provider,event_type,
            event_date,published_at,discovered_at,fetched_at,evidence_status,
            support_level,exclusion_reason
       FROM intelligence_run_evidence
      WHERE run_id=$1 AND user_id=$2
      ORDER BY created_at ASC`,
    [params.runId, guard.access.userId]
  );
  const checkpoints = await query<Record<string, unknown>>(
    `SELECT stage,status,attempt,diagnostics,started_at,completed_at,updated_at
       FROM intelligence_run_checkpoints
      WHERE run_id=$1 AND user_id=$2
      ORDER BY CASE stage
        WHEN 'understanding' THEN 1 WHEN 'retrieval' THEN 2 WHEN 'evidence' THEN 3
        WHEN 'facts' THEN 4 WHEN 'brief' THEN 5 ELSE 99 END`,
    [params.runId, guard.access.userId],
  );
  return NextResponse.json({ run: { ...rows[0], attempt_history: publicAttemptHistory(rows[0].attempt_history) }, evidence, checkpoints });
}

export async function POST(_request: Request, { params }: { params: { runId: string } }) {
  const guard = await requireIntelligenceAPI();
  if (!guard.ok) return guard.response;
  const owned = await query<{ id: string; requires_fresh_authorization: boolean }>(
    `SELECT r.id,
            (COALESCE((r.usage->>'freshExternalAuthorizationRequired')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekSearch')::boolean,false)
              OR COALESCE((r.external_cost_authorization->>'deepSeekGeneration')::boolean,false)
              OR EXISTS (
                SELECT 1 FROM intelligence_run_external_attempts a
                 WHERE a.run_id=r.id AND a.user_id=r.user_id
              )) AS requires_fresh_authorization
       FROM intelligence_runs r
      WHERE r.id=$1 AND r.user_id=$2`,
    [params.runId, guard.access.userId],
  );
  if (!owned[0]) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  if (owned[0].requires_fresh_authorization) {
    return NextResponse.json({
      error: "本次运行使用过单次外部费用授权。请回到主题页重新勾选授权并创建新运行。",
      code: "fresh_external_authorization_required",
    }, { status: 409 });
  }
  const run = await retryIntelligenceRun(guard.access.userId, params.runId);
  if (!run) return NextResponse.json({ error: "该运行不能重试或已达到重试上限" }, { status: 409 });
  return NextResponse.json({ run: publicIntelligenceRun(run) }, { status: 202 });
}
