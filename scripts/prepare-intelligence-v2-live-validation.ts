import { pool, query } from "../src/lib/db";
import { DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS } from "../src/lib/intelligenceDeepSeekGenerationBudget";
import { createIntelligenceRunWithDisposition } from "../src/lib/intelligenceRuns";

const VALIDATION_KEY = (process.env.INTELLIGENCE_VALIDATION_KEY || "v2-live-unitree-2024-20261105-1").trim();

function requireIsolation(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const database = new URL(raw);
  if (!(database.hostname === "127.0.0.1"
      && database.port === "55432"
      && database.pathname === "/aivestor_test")) {
    throw new Error("validation setup refuses any database except 127.0.0.1:55432/aivestor_test");
  }
}

async function main(): Promise<void> {
  requireIsolation();
  if (process.env.INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED !== "true") {
    throw new Error("validation setup requires INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED=true before creating a run");
  }
  if (!/^v2-live-unitree-2024-[a-z0-9-]{1,80}$/i.test(VALIDATION_KEY)) {
    throw new Error("INTELLIGENCE_VALIDATION_KEY is invalid");
  }
  const configuredUsers = await query<{
    id: string;
    ai_provider: string | null;
    ai_base_url: string | null;
  }>(
    `SELECT id,ai_provider,ai_base_url
       FROM users
      WHERE api_key_encrypted IS NOT NULL
        AND ai_provider='deepseek'
        AND (ai_base_url IS NULL OR BTRIM(ai_base_url) IN (
          'https://api.deepseek.com',
          'https://api.deepseek.com/',
          'https://api.deepseek.com/v1',
          'https://api.deepseek.com/v1/'
        ))`,
  );
  if (configuredUsers.length !== 1) {
    throw new Error(`expected exactly one official-endpoint DeepSeek BYOK test user, found ${configuredUsers.length}`);
  }
  const userId = configuredUsers[0].id;

  let taskRows = await query<{ id: string }>(
    `SELECT id FROM intelligence_tasks WHERE user_id=$1 AND create_request_key=$2`,
    [userId, VALIDATION_KEY],
  );
  if (!taskRows[0]) taskRows = await query<{ id: string }>(
    `INSERT INTO intelligence_tasks
       (user_id,name,topics,entities,keywords,regions,include_requirements,
        exclude_requirements,max_items,lookback_period,output_instructions,
        execution_mode,schedule_config,is_active,original_request,create_request_key,
        event_types,source_policy,parse_metadata)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,
             $9,$10::jsonb,$11,'manual',NULL,true,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)
     RETURNING id`,
    [
      userId,
      "宇树科技 2024 年融资动态（V2 真实验收）",
      JSON.stringify(["机器人", "股权融资"]),
      JSON.stringify(["宇树科技", "Unitree Robotics"]),
      JSON.stringify(["融资", "投资方", "融资轮次", "融资金额"]),
      JSON.stringify(["中国"]),
      JSON.stringify([
        "仅保留有公开来源支持的 2024 年融资事件",
        "区分报道发布日期与事件发生时间",
        "轮次、金额和投资方只有在来源明确支持时才可作为事实",
      ]),
      JSON.stringify(["排除纯产品发布和没有融资事实的转载"]),
      6,
      JSON.stringify({ kind: "custom", start: "2024-01-01", end: "2024-12-31" }),
      "形成简洁的股权投资情报简报；每项事实必须带可核验来源，并明确资料不足与不确定项。",
      "收集宇树科技在 2024 年发生的融资事件，核验融资轮次、金额和投资方；只采用可核验公开来源，无法证实的字段保持未知。",
      VALIDATION_KEY,
      JSON.stringify(["融资"]),
      JSON.stringify({ preferredSourceTypes: ["official", "reputable-media"], language: "zh-CN" }),
      JSON.stringify({ method: "confirmed", parsedAt: new Date().toISOString(), currentDate: "2026-11-05", warnings: [] }),
    ],
  );
  const taskId = taskRows[0]?.id;
  if (!taskId) throw new Error("validation task was not created or recovered");

  const { run, disposition } = await createIntelligenceRunWithDisposition({
    userId,
    taskId,
    idempotencyKey: VALIDATION_KEY,
    triggerType: "manual",
    authorizeDeepSeekSearch: true,
    authorizeDeepSeekGeneration: true,
    maxExternalCostUsdMicros: DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
    retrievalProviderMode: "deepseek-only",
    now: new Date("2026-11-05T00:00:00.000Z"),
  });
  if (disposition !== "created" && run.status !== "queued") {
    throw new Error(`validation intent already exists in non-queued state: ${run.status}`);
  }
  console.log(JSON.stringify({ userId, taskId, runId: run.id, disposition, status: run.status }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "validation setup failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
