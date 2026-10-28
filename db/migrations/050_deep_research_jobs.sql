-- 深度投研 P1：持久化后台研究任务与由证据缺口生成的尽调任务。

CREATE TABLE IF NOT EXISTS deep_research_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id               UUID REFERENCES orgs(id) ON DELETE CASCADE,
  report_id            UUID REFERENCES reports(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  phase                TEXT NOT NULL DEFAULT 'queued'
                         CHECK (phase IN ('queued', 'external_research', 'report_generation', 'quality_gate', 'task_creation', 'completed', 'failed')),
  progress             INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  requested_profile    TEXT NOT NULL DEFAULT 'auto'
                         CHECK (requested_profile IN ('auto', 'early_stage', 'comprehensive')),
  decision_context     TEXT,
  source_cutoff_date   DATE,
  result               JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  max_attempts         INTEGER NOT NULL DEFAULT 3,
  locked_at            TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  error_code           TEXT,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deep_research_jobs_project
  ON deep_research_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deep_research_jobs_queue
  ON deep_research_jobs(status, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deep_research_jobs_active_project
  ON deep_research_jobs(project_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS deep_research_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES deep_research_jobs(id) ON DELETE CASCADE,
  report_id         UUID REFERENCES reports(id) ON DELETE SET NULL,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id             UUID REFERENCES orgs(id) ON DELETE CASCADE,
  evidence_item_id  TEXT NOT NULL,
  title              TEXT NOT NULL,
  details            TEXT,
  priority           TEXT NOT NULL DEFAULT 'P1' CHECK (priority IN ('P0', 'P1', 'P2')),
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
  owner              TEXT,
  due_date           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, evidence_item_id)
);

CREATE INDEX IF NOT EXISTS idx_deep_research_tasks_project
  ON deep_research_tasks(project_id, status, priority, created_at DESC);

CREATE OR REPLACE TRIGGER trg_deep_research_jobs_updated
  BEFORE UPDATE ON deep_research_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_deep_research_tasks_updated
  BEFORE UPDATE ON deep_research_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
