-- 053: recoverable intelligence pipeline checkpoints
-- Additive only. Existing tasks, runs, briefs, evidence, credentials and history remain unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS intelligence_run_checkpoints (
  run_id        UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('understanding', 'retrieval', 'evidence', 'facts', 'brief')),
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'uncertain')),
  attempt       INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics   JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, stage),
  CONSTRAINT fk_intelligence_pipeline_checkpoint_owner
    FOREIGN KEY (run_id, user_id)
    REFERENCES intelligence_runs(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_pipeline_checkpoints_owner
  ON intelligence_run_checkpoints(user_id, run_id, stage);

COMMENT ON TABLE intelligence_run_checkpoints IS
  'Owner-scoped, content-bounded checkpoints for the deterministic intelligence pipeline. Never stores credentials, full prompts, raw pages, or chain-of-thought.';
COMMENT ON COLUMN intelligence_run_checkpoints.payload IS
  'Structured stage output only. Public evidence excerpts are bounded; secrets and full provider responses are forbidden.';

COMMIT;
