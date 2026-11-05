import { pool, query } from "../src/lib/db";
import { getGenerationAccess } from "../src/lib/intelligenceGeneration";
import { isOfficialDeepSeekBaseUrl } from "../src/lib/intelligenceDeepSeekAdapter";
import {
  DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
  DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT,
  DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
} from "../src/lib/intelligenceDeepSeekGenerationBudget";

const REQUIRED_TABLES = [
  "intelligence_runs",
  "intelligence_run_external_attempts",
  "intelligence_run_checkpoints",
  "intelligence_run_evidence",
  "intelligence_briefs",
] as const;

function requireIsolatedEnvironment(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const database = new URL(raw);
  if (database.hostname !== "127.0.0.1"
    || database.port !== "55432"
    || database.pathname !== "/aivestor_test") {
    throw new Error("live validation preflight refuses non-isolated databases");
  }
  if (process.env.INTELLIGENCE_DEEPSEEK_SEARCH_ENABLED !== "true") {
    throw new Error("DeepSeek Search must be explicitly enabled");
  }
  if ((process.env.INTELLIGENCE_DEEPSEEK_SEARCH_MAX_REQUESTS || "2") !== "2") {
    throw new Error("DeepSeek Search request limit must be exactly 2");
  }
  if ((process.env.INTELLIGENCE_DEEPSEEK_FETCH_MODE || "off") !== "off") {
    throw new Error("DeepSeek Fetch must remain disabled");
  }
  if (DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT !== 1
    || DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS !== 8_192
    || DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS !== 100_000) {
    throw new Error("reviewed generation or budget limits have changed");
  }
}

async function main(): Promise<void> {
  requireIsolatedEnvironment();

  const tables = await query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [[...REQUIRED_TABLES]],
  );
  const present = new Set(tables.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) throw new Error(`required migrations are missing: ${missing.join(",")}`);

  const activeRuns = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM intelligence_runs
      WHERE status IN ('queued','running')`,
  );
  if (Number(activeRuns[0]?.count || 0) !== 0) {
    throw new Error("isolated database has another active intelligence run");
  }

  const users = await query<{ id: string }>(
    `SELECT id
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
  if (users.length !== 1) {
    throw new Error(`expected exactly one official-endpoint DeepSeek BYOK test user, found ${users.length}`);
  }

  const access = await getGenerationAccess(users[0].id);
  if (!access
    || access.source !== "custom"
    || access.credentials.usingFreeQuota
    || access.credentials.provider !== "deepseek"
    || access.credentials.model !== "deepseek-v4-flash"
    || !isOfficialDeepSeekBaseUrl(access.credentials.baseURL)
    || !access.credentials.apiKey) {
    throw new Error("saved DeepSeek BYOK configuration failed the reviewed access envelope");
  }

  console.log(JSON.stringify({
    ready: true,
    database: "127.0.0.1:55432/aivestor_test",
    migrations: "051-053-compatible",
    activeRuns: 0,
    provider: "deepseek",
    model: access.credentials.model,
    source: access.source,
    officialEndpoint: true,
    searchRequests: 2,
    generationRequests: 1,
    fetchRequests: 0,
    maxOutputTokens: DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
    maxUsdMicros: DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS,
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "live validation preflight failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
