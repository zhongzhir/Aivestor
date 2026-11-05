import { pool, query } from "../src/lib/db";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "10000000-0000-4000-8000-000000000004";
const RUN_ID = "20000000-0000-4000-8000-000000000004";
const BRIEF_ID = "30000000-0000-4000-8000-000000000004";

function requireDedicatedDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1"
    || url.port !== "55435"
    || url.pathname !== "/aivestor_core_v2_test") {
    throw new Error("live replay seed refuses every database except the dedicated core-v2 integration database");
  }
}

async function main(): Promise<void> {
  requireDedicatedDatabase();
  const sourceList = [
    { source: "Oeeee", url: "https://m.mp.oeeee.com/oe/BAAFRD0000202409241002975.html", publishedAt: "2024-09-23T16:00:00.000Z", sourceTier: "B", origin: "web-search" },
    { source: "钛媒体", url: "https://www.tmtpost.com/7262451.html?rss=futu", publishedAt: "2024-09-23T16:00:00.000Z", sourceTier: "B", origin: "web-search" },
    { source: "阿里云创新中心", url: "https://startup.aliyun.com/info/1088296.html", publishedAt: "2024-09-24T16:00:00.000Z", sourceTier: "C", origin: "web-search" },
  ];
  const item = {
    id: "live-replay:unitree-b2-2024",
    title: "宇树科技2024年B2轮融资近10亿元",
    content: "公开报道显示宇树科技在2024年春节前完成B2轮融资，融资额近10亿元；美团、金石投资和源码资本参与。",
    summary: "宇树科技在2024年春节前完成B2轮融资，融资额近10亿元；当前来源未提供精确完成日。",
    investmentNote: "多源报道支持轮次和近似金额；具体完成日与完整交易文件仍需继续核验。",
    source: "Oeeee",
    sourceUrl: sourceList[0]!.url,
    sourceUrls: sourceList.map((source) => source.url),
    publishedAt: sourceList[0]!.publishedAt,
    publishedAtSource: "evidence",
    publishedAtConfidence: "high",
    eventTimeText: "2024年春节前",
    timeUnconfirmed: true,
    discoveredAt: "2024-12-31T00:00:00.000Z",
    fetchedAt: "2026-11-05T04:41:58.828Z",
    subject: "宇树科技",
    region: "中国",
    kind: "other",
    isClue: true,
    sourceTier: "B",
    origin: "web-search",
    importance: "high",
    relevance: "high",
    confidence: "medium",
    evidenceStatus: "full",
    supportLevel: "corroborating",
    eventType: "融资",
    followUpReason: "精确完成日和公司原始交易文件仍待核验",
  };
  const taskSnapshot = {
    taskId: TASK_ID,
    configVersion: 1,
    name: "真实检索回放：宇树科技2024年股权融资",
    originalRequest: "收集宇树科技在2024年发生的融资事件，核验轮次、金额和投资方",
    topics: ["机器人", "股权投资"],
    entities: ["宇树科技", "Unitree Robotics"],
    keywords: ["融资", "投资方", "融资轮次", "融资金额"],
    regions: ["中国"],
    includeRequirements: ["只保留有公开来源支持的事项"],
    excludeRequirements: ["排除纯产品发布"],
    maxItems: 6,
    lookbackPeriod: { kind: "custom", start: "2024-01-01T00:00:00.000Z", end: "2024-12-31T00:00:00.000Z" },
    outputInstructions: "每项事实带来源并说明不确定项",
    executionMode: "manual",
    scheduleConfig: null,
    isActive: false,
    eventTypes: ["融资"],
    sourcePolicy: { preferredSourceTypes: ["official", "reputable-media"], language: "zh-CN" },
  };
  const metadata = {
    overview: "本次基于已核验来源形成 1 条线索；金额限定词和模糊事件时间均保持原始口径。",
    origins: ["web-search"],
    generationProvider: "controlled-offline-replay",
    generationModel: null,
    retrieval: {
      status: "partial",
      providers: [{ provider: "deepseek-search", attempted: true, succeeded: true, queryCount: 2, resultCount: 18, status: "success", coverageCapability: "coarse" }],
      searchCandidates: 18,
      relevancePassed: 3,
      relevanceDropped: 15,
      evidence: { full: 3, partial: 0, unavailable: 9 },
      final: { facts: 0, clues: 1, trends: 0 },
      coverageConclusion: "items_found",
      sources: sourceList.map((source) => ({ ...source, title: item.title, provider: "deepseek-search", fetchedAt: item.fetchedAt, evidenceStatus: "full", exclusionReason: null })),
    },
    research: {
      mode: "pipeline-v2",
      pipelineVersion: 2,
      stages: ["understanding", "retrieval", "evidence", "facts", "brief"],
      confidence: "medium",
      unresolvedGaps: ["具体完成日未知", "C轮属性未全部通过证据门禁"],
      validation: { totalItems: 2, acceptedItems: 1, rejectedItems: 1, rejectionReasons: { unsupported_attributes: 1 }, sanitizedFields: {} },
    },
  };

  await query(
    `INSERT INTO intelligence_tasks
       (id,user_id,name,topics,entities,keywords,regions,include_requirements,exclude_requirements,
        max_items,lookback_period,output_instructions,execution_mode,schedule_config,is_active,
        original_request,config_version,event_types,source_policy)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
             $10,$11::jsonb,$12,'manual',NULL,false,$13,1,$14::jsonb,$15::jsonb)`,
    [TASK_ID, USER_ID, taskSnapshot.name, JSON.stringify(taskSnapshot.topics), JSON.stringify(taskSnapshot.entities), JSON.stringify(taskSnapshot.keywords), JSON.stringify(taskSnapshot.regions), JSON.stringify(taskSnapshot.includeRequirements), JSON.stringify(taskSnapshot.excludeRequirements), taskSnapshot.maxItems, JSON.stringify(taskSnapshot.lookbackPeriod), taskSnapshot.outputInstructions, taskSnapshot.originalRequest, JSON.stringify(taskSnapshot.eventTypes), JSON.stringify(taskSnapshot.sourcePolicy)],
  );
  await query(
    `INSERT INTO intelligence_runs
       (id,task_id,user_id,trigger_type,status,idempotency_key,config_version,config_snapshot,
        coverage_start,coverage_end,attempt_count,max_attempts,attempt_history,provider_call_state,
        started_at,finished_at,retrieval_status,provider_diagnostics,evidence_summary,usage,created_at,updated_at)
     VALUES ($1,$2,$3,'manual','partial','offline-live-replay-v2',1,$4::jsonb,
             '2024-01-01T00:00:00.000Z','2024-12-31T00:00:00.000Z',1,3,'[]'::jsonb,'completed',
             '2026-11-05T04:41:55.608Z','2026-11-05T04:42:21.165Z','success',$5::jsonb,$6::jsonb,$7::jsonb,
             '2026-11-05T04:41:55.608Z','2026-11-05T04:42:21.165Z')`,
    [RUN_ID, TASK_ID, USER_ID, JSON.stringify(taskSnapshot), JSON.stringify(metadata.retrieval.providers), JSON.stringify(metadata.retrieval.evidence), JSON.stringify({ deepseekSearchFetch: { usage: { searchAttempts: 2, searchCompleted: 2, estimatedBillableUsdMicros: 1500 } }, deepseekGeneration: { attempts: 1, completed: 1, estimatedBillableUsdMicros: 5394 } })],
  );
  await query(
    `INSERT INTO intelligence_briefs
       (id,task_id,user_id,task_name,coverage_start,coverage_end,generated_at,item_count,
        important_facts,trend_signals,other_items,source_list,metadata,run_id,schema_version)
     VALUES ($1,$2,$3,$4,'2024-01-01T00:00:00.000Z','2024-12-31T00:00:00.000Z','2024-12-31T00:00:00.000Z',1,
             '[]'::jsonb,'[]'::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,2)`,
    [BRIEF_ID, TASK_ID, USER_ID, taskSnapshot.name, JSON.stringify([item]), JSON.stringify(sourceList), JSON.stringify(metadata), RUN_ID],
  );
  await query(
    `INSERT INTO intelligence_run_external_attempts
       (id,run_id,user_id,run_attempt_number,provider,capability,status,billable,request_ordinal,reserved_usd_micros,estimated_billable_usd_micros)
     VALUES (gen_random_uuid(),$1,$2,1,'deepseek-web','search','completed',true,1,750,750),
            (gen_random_uuid(),$1,$2,1,'deepseek-web','search','completed',true,2,750,750),
            (gen_random_uuid(),$1,$2,1,'deepseek','generation','completed',true,1,13088,5394)`,
    [RUN_ID, USER_ID],
  );
  for (const source of sourceList) {
    await query(
      `INSERT INTO intelligence_run_evidence
         (run_id,user_id,item_key,canonical_url,source_name,source_tier,retrieval_provider,
          published_at,evidence_status,support_level,supports_fact_keys,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'deepseek-search',$7,'full','corroborating',$8::jsonb,$9::jsonb)`,
      [RUN_ID, USER_ID, `replay:${source.source}`, source.url, source.source, source.sourceTier, source.publishedAt, JSON.stringify([item.id]), JSON.stringify({ replay: "saved-live-public-source", attempted: true })],
    );
  }
  for (const [stage, status, diagnostics] of [
    ["understanding", "completed", {}],
    ["retrieval", "completed", { queryCount: 2, candidateCount: 18 }],
    ["evidence", "completed", { full: 3, unavailable: 9 }],
    ["facts", "partial", { totalItems: 2, acceptedItems: 1, rejectedItems: 1 }],
    ["brief", "partial", { itemCount: 1, rejectedItems: 1 }],
  ] as const) {
    await query(
      `INSERT INTO intelligence_run_checkpoints
         (run_id,user_id,stage,status,attempt,payload,diagnostics,completed_at,updated_at)
       VALUES ($1,$2,$3,$4,1,'{}'::jsonb,$5::jsonb,NOW(),NOW())`,
      [RUN_ID, USER_ID, stage, status, JSON.stringify(diagnostics)],
    );
  }
  console.log(JSON.stringify({ passed: true, evidenceLayer: "saved-live-public-sources", generationLayer: "controlled-offline-replay", taskId: TASK_ID, runId: RUN_ID, briefId: BRIEF_ID, paidRequests: 0 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
