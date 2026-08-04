-- ============================================================
-- 迁移 044：情报订制 P0
-- 注意：本迁移只提供文件，不自动执行；上线前由 DBA 人工执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS intelligence_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  topics                JSONB NOT NULL DEFAULT '[]'::jsonb,
  entities              JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords              JSONB NOT NULL DEFAULT '[]'::jsonb,
  regions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  include_requirements  JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclude_requirements  JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_items             INTEGER NOT NULL DEFAULT 10 CHECK (max_items BETWEEN 1 AND 50),
  lookback_period       JSONB NOT NULL DEFAULT '{"kind":"days","value":3}'::jsonb,
  output_instructions   TEXT NOT NULL DEFAULT '',
  execution_mode        TEXT NOT NULL DEFAULT 'manual' CHECK (execution_mode IN ('manual', 'scheduled')),
  schedule_config       JSONB,
  is_active              BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (execution_mode = 'manual' OR schedule_config IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_tasks_user_active
  ON intelligence_tasks(user_id, is_active, updated_at DESC);

CREATE OR REPLACE TRIGGER trg_intelligence_tasks_updated
  BEFORE UPDATE ON intelligence_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS intelligence_briefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES intelligence_tasks(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_name       TEXT NOT NULL,
  coverage_start  TIMESTAMPTZ NOT NULL,
  coverage_end    TIMESTAMPTZ NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_count      INTEGER NOT NULL DEFAULT 0,
  important_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  trend_signals   JSONB NOT NULL DEFAULT '[]'::jsonb,
  other_items     JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_list     JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_slot  TEXT
);

CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_user_time
  ON intelligence_briefs(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_task_time
  ON intelligence_briefs(task_id, generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_briefs_scheduled_slot
  ON intelligence_briefs(task_id, scheduled_slot)
  WHERE scheduled_slot IS NOT NULL;

CREATE TABLE IF NOT EXISTS intelligence_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID REFERENCES intelligence_tasks(id) ON DELETE SET NULL,
  brief_id    UUID NOT NULL REFERENCES intelligence_briefs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  feedback    TEXT NOT NULL CHECK (feedback IN ('valuable', 'irrelevant')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, brief_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_feedback_task
  ON intelligence_feedback(user_id, task_id, created_at DESC);
