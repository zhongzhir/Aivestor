import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const url = new URL(connectionString);
if (!(url.hostname === "127.0.0.1"
  && url.port === "55435"
  && url.pathname === "/aivestor_core_v2_test")) {
  throw new Error("integration setup refuses every database except 127.0.0.1:55435/aivestor_core_v2_test");
}

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        phone TEXT,
        name TEXT NOT NULL,
        password_hash TEXT,
        image_url TEXT,
        plan TEXT NOT NULL DEFAULT 'personal',
        auth_provider TEXT NOT NULL DEFAULT 'credentials',
        api_key_encrypted TEXT,
        ai_provider TEXT DEFAULT 'deepseek',
        ai_base_url TEXT,
        password_changed_at TIMESTAMPTZ,
        onboarding_completed BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE login_attempts (
        id BIGSERIAL PRIMARY KEY,
        identifier TEXT NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE orgs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE org_members (
        org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        PRIMARY KEY (org_id,user_id)
      );
      CREATE TABLE free_quota_usage (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tokens_used BIGINT NOT NULL DEFAULT 0,
        tokens_limit BIGINT NOT NULL DEFAULT 5000000,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE free_quota_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        feature TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    for (const name of [
      "044_intelligence_subscriptions.sql",
      "045_intelligence_source_items.sql",
      "046_intelligence_brief_metadata.sql",
    ]) {
      await client.query(readFileSync(join(process.cwd(), "db", "migrations", name), "utf8"));
    }

    // Seed legacy rows before 051 to prove the upgrade preserves historical data.
    await client.query(`
      INSERT INTO users (id,email,name,plan,auth_provider)
      VALUES ('00000000-0000-4000-8000-000000000003','legacy.integration@aivestor.local','旧版迁移用户','personal','credentials');
      INSERT INTO intelligence_tasks
        (id,user_id,name,topics,max_items,lookback_period,execution_mode,is_active)
      VALUES ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003',
              '旧版保留主题','["并购"]'::jsonb,10,'{"kind":"days","value":30}'::jsonb,'manual',false);
      INSERT INTO intelligence_briefs
        (id,task_id,user_id,task_name,coverage_start,coverage_end,item_count,important_facts,metadata)
      VALUES ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',
              '00000000-0000-4000-8000-000000000003','旧版保留主题',NOW()-INTERVAL '30 days',NOW(),1,
              '[{"id":"legacy-fact","title":"旧成果"}]'::jsonb,'{"overview":"旧版简报"}'::jsonb);
      INSERT INTO intelligence_feedback
        (task_id,brief_id,user_id,item_key,feedback)
      VALUES ('10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',
              '00000000-0000-4000-8000-000000000003','legacy-fact','valuable');
    `);
    for (const name of [
      "051_intelligence_workspace.sql",
      "052_intelligence_external_generation_budget.sql",
      "053_intelligence_pipeline_checkpoints.sql",
    ]) {
      await client.query(readFileSync(join(process.cwd(), "db", "migrations", name), "utf8"));
    }

    const legacy = await client.query<{ tasks: string; briefs: string; feedback: string; run_id: string | null }>(`
      SELECT
        (SELECT COUNT(*)::text FROM intelligence_tasks WHERE id='10000000-0000-4000-8000-000000000003') AS tasks,
        (SELECT COUNT(*)::text FROM intelligence_briefs WHERE id='30000000-0000-4000-8000-000000000003') AS briefs,
        (SELECT COUNT(*)::text FROM intelligence_feedback WHERE brief_id='30000000-0000-4000-8000-000000000003') AS feedback,
        (SELECT run_id::text FROM intelligence_briefs WHERE id='30000000-0000-4000-8000-000000000003') AS run_id
    `);
    if (JSON.stringify(legacy.rows[0]) !== JSON.stringify({ tasks: "1", briefs: "1", feedback: "1", run_id: null })) {
      throw new Error(`legacy intelligence migration preservation failed: ${JSON.stringify(legacy.rows[0])}`);
    }

    const password = process.env.E2E_PASSWORD || "Integration#2026";
    const email = process.env.E2E_EMAIL || "intelligence.integration@aivestor.local";
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (id,email,name,password_hash,plan,auth_provider)
       VALUES ('00000000-0000-4000-8000-000000000001',$1,'情报集成测试',$2,'personal','credentials') RETURNING id`,
      [email, passwordHash],
    );
    await client.query(
      `INSERT INTO users (id,email,name,plan,auth_provider)
       VALUES ('00000000-0000-4000-8000-000000000002','other.integration@aivestor.local','隔离用户B','personal','credentials')`,
    );
    await client.query("INSERT INTO free_quota_usage (user_id) VALUES ($1)", [user.rows[0].id]);
    await client.query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,original_request,event_types,
          source_policy,next_run_at)
       VALUES ('10000000-0000-4000-8000-000000000001',$1,'机器人企业资本动态周报',$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,
               $6::jsonb,'[]'::jsonb,10,$7::jsonb,'隔离测试周报','scheduled',$8::jsonb,
               true,'每周一上午8点跟踪机器人企业资本动态',$9::jsonb,$10::jsonb,
               NOW() - INTERVAL '17 minutes')`,
      [user.rows[0].id, JSON.stringify(["机器人"]), JSON.stringify([]), JSON.stringify(["融资", "并购"]), JSON.stringify(["中国"]), JSON.stringify(["融资", "并购"]), JSON.stringify({ kind: "days", value: 7 }), JSON.stringify({ frequency: "weekly", weekdays: [1], time: "08:00", timezone: "Asia/Shanghai" }), JSON.stringify(["融资", "并购"]), JSON.stringify({ preference: "official-first" })],
    );
    await client.query(
      `INSERT INTO intelligence_tasks
         (id,user_id,name,topics,entities,keywords,regions,include_requirements,
          exclude_requirements,max_items,lookback_period,output_instructions,
          execution_mode,schedule_config,is_active,event_types,source_policy)
       VALUES ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
               '用户B私有主题','["私有"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
               '[]'::jsonb,'[]'::jsonb,10,'{"kind":"days","value":7}'::jsonb,'',
               'manual',NULL,true,'[]'::jsonb,'{}'::jsonb)`,
    );
    await client.query(
      `INSERT INTO intelligence_runs
         (id,task_id,user_id,trigger_type,status,idempotency_key,config_version,config_snapshot,
          coverage_start,coverage_end,attempt_count,finished_at,retrieval_status,error_code,error_message_safe)
       VALUES ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
               '00000000-0000-4000-8000-000000000002','manual','failed','user-b-private-run',1,
               '{"name":"用户B私有主题","topics":["私有"],"entities":[],"keywords":[],"regions":[],"includeRequirements":[],"excludeRequirements":[],"maxItems":10,"lookbackPeriod":{"kind":"days","value":7},"outputInstructions":"","executionMode":"manual","scheduleConfig":null,"isActive":true,"taskId":"10000000-0000-4000-8000-000000000002","configVersion":1,"eventTypes":[],"sourcePolicy":{}}'::jsonb,
               NOW()-INTERVAL '7 days',NOW(),1,NOW(),'failed','fixture_private','私有失败')`,
    );
    await client.query(
      `INSERT INTO intelligence_briefs
         (id,task_id,user_id,task_name,coverage_start,coverage_end,item_count,metadata,run_id,schema_version)
       VALUES ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
               '00000000-0000-4000-8000-000000000002','用户B私有主题',NOW()-INTERVAL '7 days',NOW(),0,
               '{"overview":"私有","retrieval":{"status":"failed","providers":[]}}'::jsonb,
               '20000000-0000-4000-8000-000000000002',2)`,
    );
    console.log("intelligence integration database ready");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
