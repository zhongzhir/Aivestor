-- 情报工作空间：可审计执行、调度心跳、证据清单与归档。
-- 仅新增表/列；不改写既有任务、简报或反馈。
BEGIN;

ALTER TABLE intelligence_tasks
  ADD COLUMN IF NOT EXISTS original_request TEXT,
  ADD COLUMN IF NOT EXISTS create_request_key TEXT,
  ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parse_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_tasks_id_user
  ON intelligence_tasks(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_tasks_user_create_request
  ON intelligence_tasks(user_id, create_request_key)
  WHERE create_request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intelligence_tasks_user_workspace
  ON intelligence_tasks(user_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_tasks_due
  ON intelligence_tasks(next_run_at ASC)
  WHERE archived_at IS NULL AND is_active = true AND execution_mode = 'scheduled';

CREATE TABLE IF NOT EXISTS intelligence_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'catchup', 'retry')),
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'no_new_items', 'failed', 'blocked', 'cancelled')),
  idempotency_key       TEXT NOT NULL,
  config_version        INTEGER NOT NULL,
  config_snapshot       JSONB NOT NULL,
  external_cost_authorization JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for         TIMESTAMPTZ,
  coverage_start        TIMESTAMPTZ NOT NULL,
  coverage_end          TIMESTAMPTZ NOT NULL,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 3,
  attempt_history       JSONB NOT NULL DEFAULT '[]'::jsonb,
  locked_at             TIMESTAMPTZ,
  locked_by             TEXT,
  provider_call_state   TEXT NOT NULL DEFAULT 'none'
                          CHECK (provider_call_state IN ('none', 'started', 'completed', 'uncertain')),
  provider_call_started_at TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  retrieval_status      TEXT CHECK (retrieval_status IS NULL OR retrieval_status IN ('success', 'partial', 'failed', 'unknown')),
  provider_diagnostics  JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  usage                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code            TEXT,
  error_message_safe    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_intelligence_runs_task_owner
    FOREIGN KEY (task_id, user_id)
    REFERENCES intelligence_tasks(id, user_id)
    ON DELETE CASCADE,
  UNIQUE (task_id, idempotency_key),
  UNIQUE (id, user_id)
);

-- 兼容已在隔离环境执行过本迁移的数据库；只新增安全默认列，不改写历史授权。
ALTER TABLE intelligence_runs
  ADD COLUMN IF NOT EXISTS external_cost_authorization JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_intelligence_runs_task_created
  ON intelligence_runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_user_created
  ON intelligence_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_queue
  ON intelligence_runs(status, created_at ASC)
  WHERE status IN ('queued', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_runs_task_active
  ON intelligence_runs(task_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS intelligence_run_external_attempts (
  id                         UUID PRIMARY KEY,
  run_id                     UUID NOT NULL,
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_attempt_number         INTEGER NOT NULL CHECK (run_attempt_number > 0),
  request_ordinal            INTEGER NOT NULL CHECK (request_ordinal > 0),
  provider                   TEXT NOT NULL CHECK (provider = 'deepseek-web'),
  capability                 TEXT NOT NULL CHECK (capability IN ('search', 'fetch')),
  status                     TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed', 'uncertain')),
  reserved_usd_micros        INTEGER NOT NULL CHECK (reserved_usd_micros >= 0),
  estimated_billable_usd_micros INTEGER NOT NULL DEFAULT 0 CHECK (estimated_billable_usd_micros >= 0),
  billable                   BOOLEAN,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at                 TIMESTAMPTZ,
  CONSTRAINT fk_intelligence_external_attempt_owner
    FOREIGN KEY (run_id, user_id)
    REFERENCES intelligence_runs(id, user_id)
    ON DELETE CASCADE,
  UNIQUE (run_id, run_attempt_number, provider, capability, request_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_external_attempts_run
  ON intelligence_run_external_attempts(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_intelligence_external_attempts_unsettled
  ON intelligence_run_external_attempts(status, created_at ASC)
  WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS intelligence_run_request_keys (
  task_id         UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  run_id          UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, idempotency_key),
  CONSTRAINT fk_intelligence_run_request_task_owner
    FOREIGN KEY (task_id, user_id)
    REFERENCES intelligence_tasks(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_intelligence_run_request_run_owner
    FOREIGN KEY (run_id, user_id)
    REFERENCES intelligence_runs(id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS intelligence_run_evidence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key            TEXT NOT NULL CHECK (char_length(item_key) <= 200),
  canonical_url       TEXT NOT NULL CHECK (char_length(canonical_url) <= 1800),
  source_name         TEXT NOT NULL,
  source_tier         TEXT,
  retrieval_provider  TEXT,
  event_type          TEXT,
  event_date          TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  discovered_at       TIMESTAMPTZ,
  fetched_at          TIMESTAMPTZ,
  evidence_status     TEXT CHECK (evidence_status IS NULL OR evidence_status IN ('full', 'partial', 'unavailable')),
  support_level       TEXT CHECK (support_level IS NULL OR support_level IN ('direct', 'corroborating', 'context', 'unknown')),
  supports_fact_keys  JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusion_reason    TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_intelligence_run_evidence_owner
    FOREIGN KEY (run_id, user_id)
    REFERENCES intelligence_runs(id, user_id)
    ON DELETE CASCADE,
  UNIQUE (run_id, item_key, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_run_evidence_run
  ON intelligence_run_evidence(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_intelligence_run_evidence_url
  ON intelligence_run_evidence(canonical_url);

CREATE TABLE IF NOT EXISTS intelligence_scheduler_heartbeats (
  worker_key        TEXT PRIMARY KEY,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  last_cycle_succeeded_at TIMESTAMPTZ,
  last_cycle_error_at TIMESTAMPTZ,
  last_cycle_error_code TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS intelligence_quota_reservations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  status      TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_intelligence_quota_run_owner
    FOREIGN KEY (run_id, user_id)
    REFERENCES intelligence_runs(id, user_id)
    ON DELETE CASCADE,
  UNIQUE (run_id, attempt_number)
);

ALTER TABLE intelligence_briefs
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_briefs_run
  ON intelligence_briefs(run_id)
  WHERE run_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_intelligence_briefs_run_owner'
  ) THEN
    ALTER TABLE intelligence_briefs
      ADD CONSTRAINT fk_intelligence_briefs_run_owner
      FOREIGN KEY (run_id, user_id)
      REFERENCES intelligence_runs(id, user_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE TRIGGER trg_intelligence_runs_updated
  BEFORE UPDATE ON intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_intelligence_quota_reservations_updated
  BEFORE UPDATE ON intelligence_quota_reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN intelligence_tasks.original_request IS
  '用户原始研究意图；仅任务所有者可读，随归档保留，不保存模型思维过程。';
COMMENT ON COLUMN intelligence_runs.config_snapshot IS
  '本次执行的不可变任务配置快照；修改任务只影响后续 run。';
COMMENT ON COLUMN intelligence_runs.provider_diagnostics IS
  '安全结构化供应商摘要；禁止凭据、完整 prompt、思维过程与原始整页内容。';
COMMENT ON COLUMN intelligence_runs.external_cost_authorization IS
  '仅本次 run 的外部费用授权；计划运行默认空，重试不会继承，不包含凭据。';
COMMENT ON TABLE intelligence_run_external_attempts IS
  '每次外部付费请求前持久化的预算预留与结算；禁止保存 Key、查询、prompt、正文或响应内容。';

COMMIT;
