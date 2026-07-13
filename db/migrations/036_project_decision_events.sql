-- Migration 036: project decision gate events
-- Records formal investment process gates such as screening, project approval,
-- diligence, IC decision, closing, post-investment, pass and exit.

CREATE TABLE IF NOT EXISTS project_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  stage VARCHAR(40) NOT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'stage_gate',
  status VARCHAR(40) NOT NULL DEFAULT 'recorded',
  title VARCHAR(120) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_decision_events_stage_check'
  ) THEN
    ALTER TABLE project_decision_events
      ADD CONSTRAINT project_decision_events_stage_check
      CHECK (stage IN (
        'screening',
        'due_diligence',
        'investment_committee',
        'post_investment',
        'passed',
        'exited'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_decision_events_type_check'
  ) THEN
    ALTER TABLE project_decision_events
      ADD CONSTRAINT project_decision_events_type_check
      CHECK (event_type IN (
        'stage_gate',
        'project_approval',
        'ic_memo',
        'ic_decision',
        'term_decision',
        'post_investment',
        'exit_decision'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_decision_events_status_check'
  ) THEN
    ALTER TABLE project_decision_events
      ADD CONSTRAINT project_decision_events_status_check
      CHECK (status IN (
        'draft',
        'submitted',
        'approved',
        'rejected',
        'deferred',
        'needs_more',
        'recorded'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_decision_events_project
  ON project_decision_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_decision_events_org
  ON project_decision_events(org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

COMMENT ON TABLE project_decision_events IS 'Formal project decision gate records';
COMMENT ON COLUMN project_decision_events.stage IS 'Project lifecycle stage at the decision gate';
COMMENT ON COLUMN project_decision_events.event_type IS 'Decision event type, such as project approval or IC decision';
COMMENT ON COLUMN project_decision_events.status IS 'Gate result or workflow status';
