-- Phase 3: project relationship context MVP
CREATE TABLE IF NOT EXISTS project_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  role_title TEXT,
  organization_name TEXT,
  relationship_type TEXT NOT NULL DEFAULT 'founder'
    CHECK (relationship_type IN ('founder', 'co_investor', 'expert', 'referrer', 'customer', 'other')),
  relationship_strength INTEGER NOT NULL DEFAULT 3
    CHECK (relationship_strength BETWEEN 1 AND 5),
  source_note TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_relationships_project
  ON project_relationships(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_relationships_user
  ON project_relationships(user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_relationships_updated'
  ) THEN
    CREATE TRIGGER trg_project_relationships_updated
      BEFORE UPDATE ON project_relationships
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
