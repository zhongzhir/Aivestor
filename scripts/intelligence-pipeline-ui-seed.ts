import bcrypt from "bcryptjs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const database = new URL(connectionString);
if (!(database.hostname === "127.0.0.1" && database.port === "55435" && database.pathname === "/aivestor_core_v2_test")) {
  throw new Error("pipeline UI seed refuses any database except the isolated core-v2 database");
}

const existingUserId = process.env.PIPELINE_UI_EXISTING_USER_ID?.trim() || null;
const USER_ID = existingUserId || "90000000-0000-4000-8000-000000000001";
const TASK_ID = "90000000-0000-4000-8000-000000000101";
const COMPLETED_RUN_ID = "90000000-0000-4000-8000-000000000201";
const RUNNING_RUN_ID = "90000000-0000-4000-8000-000000000202";
const FAILED_AUTH_RUN_ID = "90000000-0000-4000-8000-000000000203";
const BRIEF_ID = "90000000-0000-4000-8000-000000000301";
const email = process.env.PIPELINE_UI_EXISTING_EMAIL?.trim() || "pipeline-ui@example.test";
const password = process.env.PIPELINE_UI_EXISTING_PASSWORD || "Pipeline-Local-Only!";

const taskSnapshot = {
  taskId: TASK_ID,
  configVersion: 1,
  name: "流水线同源多事件验收",
  originalRequest: "每周关注机器人企业融资、并购与资本合作",
  topics: ["机器人"], entities: [], keywords: ["融资", "并购"], regions: ["中国"],
  includeRequirements: ["说明投资方和轮次"], excludeRequirements: [], maxItems: 10,
  lookbackPeriod: { kind: "days", value: 7 }, outputInstructions: "引用可核验来源",
  executionMode: "manual", scheduleConfig: null, isActive: false,
  eventTypes: ["融资", "并购"], sourcePolicy: {},
};

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    if (existingUserId) {
      const owner = await client.query("SELECT id FROM users WHERE id=$1", [USER_ID]);
      if (owner.rowCount !== 1) throw new Error("PIPELINE_UI_EXISTING_USER_ID does not exist in the isolated database");
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO users (id,email,name,password_hash,auth_provider,plan)
         VALUES ($1,$2,'Pipeline UI Test',$3,'credentials','personal')
         ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash`,
        [USER_ID, email, passwordHash],
      );
    }
    await client.query("DELETE FROM login_attempts WHERE identifier=$1", [email]);
    // Fixed fixture IDs may already belong to a user created by an earlier test
    // run. The database is hard-gated above to the disposable 55435 target, so
    // remove the fixture root and let ON DELETE CASCADE clear only its children.
    // This keeps authentication ownership deterministic across repeated E2E runs.
    await client.query("DELETE FROM intelligence_tasks WHERE id=$1", [TASK_ID]);
    await client.query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,exclude_requirements,
          max_items,lookback_period,output_instructions,execution_mode,schedule_config,is_active,
          original_request,config_version,event_types,source_policy)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,'[]'::jsonb,
               10,$9::jsonb,'引用可核验来源','manual',NULL,false,$10,1,$11::jsonb,'{}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,is_active=false,archived_at=NULL,original_request=EXCLUDED.original_request`,
      [TASK_ID, USER_ID, taskSnapshot.name, JSON.stringify(taskSnapshot.topics), JSON.stringify(taskSnapshot.entities),
        JSON.stringify(taskSnapshot.keywords), JSON.stringify(taskSnapshot.regions), JSON.stringify(taskSnapshot.includeRequirements),
        JSON.stringify(taskSnapshot.lookbackPeriod), taskSnapshot.originalRequest, JSON.stringify(taskSnapshot.eventTypes)],
    );
    for (const [id, status, createdAt] of [
      [COMPLETED_RUN_ID, "partial", "2026-11-03T08:00:00.000Z"],
      [RUNNING_RUN_ID, "running", "2026-11-04T08:00:00.000Z"],
      [FAILED_AUTH_RUN_ID, "blocked", "2026-11-02T08:00:00.000Z"],
    ] as const) {
      await client.query(
        `INSERT INTO intelligence_runs
           (id,task_id,user_id,trigger_type,status,idempotency_key,config_version,config_snapshot,
            coverage_start,coverage_end,attempt_count,max_attempts,attempt_history,provider_call_state,
            started_at,finished_at,retrieval_status,provider_diagnostics,evidence_summary,usage,created_at,updated_at,locked_by,locked_at)
         VALUES ($1,$2,$3,'manual',$4,$5,1,$6::jsonb,'2024-01-01T00:00:00.000Z','2024-12-31T23:59:59.999Z',
                 1,3,'[]'::jsonb,'completed',$7::timestamptz,$8::timestamptz,$9,$10::jsonb,$11::jsonb,'{}'::jsonb,
                 $7::timestamptz,$7::timestamptz,$12,$13::timestamptz)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,finished_at=EXCLUDED.finished_at,
           retrieval_status=EXCLUDED.retrieval_status,provider_diagnostics=EXCLUDED.provider_diagnostics,
           locked_by=EXCLUDED.locked_by,locked_at=EXCLUDED.locked_at,updated_at=EXCLUDED.updated_at`,
        [
          id, TASK_ID, USER_ID, status, `ui:${id}`, JSON.stringify(taskSnapshot), createdAt,
          status === "running" ? null : "2026-11-03T08:05:00.000Z",
          status === "running" ? "success" : "partial",
          JSON.stringify([{ provider: "controlled-search", attempted: true, succeeded: true, queryCount: 2, resultCount: 1, status: "success", coverageCapability: "coarse" }]),
          JSON.stringify({ full: 1, partial: 0, unavailable: 0 }),
          status === "running" ? "ui-fixture-worker" : null,
          status === "running" ? createdAt : null,
        ],
      );
    }
    await client.query(
      `UPDATE intelligence_runs
          SET usage='{"freshExternalAuthorizationRequired":true}'::jsonb,
              error_code='external_authorization_expired',
              error_message_safe='本次运行使用的单次费用授权已经结束。'
        WHERE id=$1 AND user_id=$2`,
      [FAILED_AUTH_RUN_ID, USER_ID],
    );
    const sharedSourceUrl = "https://example.com/unitree-financing-rounds";
    const item = {
      id: "pipeline:unitree-b2",
      title: "宇树科技完成 B2 轮融资",
      content: "公开报道显示宇树科技完成 B2 轮融资。",
      summary: "公开报道显示宇树科技完成 B2 轮融资。",
      investmentNote: "该事项反映机器人赛道资本关注度。",
      source: "受控公开来源",
      sourceUrl: sharedSourceUrl,
      sourceUrls: [sharedSourceUrl],
      publishedAt: "2024-02-02T00:00:00.000Z",
      eventDate: "2024-02-01",
      eventDateSupport: "evidence",
      eventType: "融资",
      subject: "宇树科技",
      region: "中国",
      kind: "fact",
      sourceTier: "A",
      origin: "web-search",
      evidenceStatus: "full",
      supportLevel: "direct",
    };
    const secondItem = {
      ...item,
      id: "pipeline:unitree-c",
      title: "宇树科技完成 C 轮融资",
      content: "同一公开页面还显示宇树科技完成 C 轮融资。",
      summary: "同一公开页面还显示宇树科技完成 C 轮融资。",
      investmentNote: "两轮融资属于不同事项，不应因共享来源而合并。",
      publishedAt: "2024-09-24T00:00:00.000Z",
      eventDate: undefined,
      eventTimeText: "2024年9月",
    };
    const metadata = {
      overview: "已形成两项共享同一来源的融资事实；当前新一期正在核验正文。",
      origins: ["web-search"], generationProvider: "controlled", generationModel: "offline",
      retrieval: {
        status: "partial", providers: [{ provider: "controlled-search", attempted: true, succeeded: true, queryCount: 2, resultCount: 1, status: "success", coverageCapability: "coarse" }],
        searchCandidates: 1, relevancePassed: 2, relevanceDropped: 0,
        evidence: { full: 1, partial: 0, unavailable: 0 }, final: { facts: 2, clues: 0, trends: 0 },
        coverageConclusion: "items_found",
        sources: [{ url: item.sourceUrl, title: item.title, source: item.source, sourceTier: "A", provider: "controlled-search", publishedAt: item.publishedAt, fetchedAt: "2026-11-03T08:04:00.000Z", evidenceStatus: "full", exclusionReason: null }],
      },
      research: { mode: "pipeline-v2", pipelineVersion: 2, stages: ["understanding", "retrieval", "evidence", "facts", "brief"], unresolvedGaps: [], confidence: "medium" },
    };
    await client.query(
      `INSERT INTO intelligence_briefs
         (id,task_id,user_id,task_name,coverage_start,coverage_end,generated_at,item_count,
          important_facts,trend_signals,other_items,source_list,metadata,run_id,schema_version)
       VALUES ($1,$2,$3,$4,'2024-01-01T00:00:00.000Z','2024-12-31T23:59:59.999Z','2026-11-03T08:05:00.000Z',2,
               $5::jsonb,'[]'::jsonb,'[]'::jsonb,$6::jsonb,$7::jsonb,$8,2)
       ON CONFLICT (id) DO UPDATE SET item_count=EXCLUDED.item_count,important_facts=EXCLUDED.important_facts,
         source_list=EXCLUDED.source_list,metadata=EXCLUDED.metadata`,
      [BRIEF_ID, TASK_ID, USER_ID, taskSnapshot.name, JSON.stringify([item, secondItem]), JSON.stringify([{ source: item.source, url: item.sourceUrl, publishedAt: item.publishedAt, sourceTier: "A", origin: "web-search" }]), JSON.stringify(metadata), COMPLETED_RUN_ID],
    );
    await client.query(
      `INSERT INTO intelligence_run_checkpoints (run_id,user_id,stage,status,attempt,payload,diagnostics,completed_at,updated_at)
       VALUES ($1,$2,'brief','completed',1,'{}'::jsonb,'{"itemCount":2}'::jsonb,NOW(),NOW()),
              ($3,$2,'evidence','running',1,'{"selectedEvidenceIds":["source:unitree"]}'::jsonb,'{}'::jsonb,NULL,NOW())
       ON CONFLICT (run_id,stage) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,diagnostics=EXCLUDED.diagnostics,updated_at=NOW()`,
      [COMPLETED_RUN_ID, USER_ID, RUNNING_RUN_ID],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ email, password, taskId: TASK_ID }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
