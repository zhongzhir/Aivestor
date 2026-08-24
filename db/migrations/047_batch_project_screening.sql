-- 迁移 047：股权投资机构批量项目初筛（最小版本）
BEGIN;

CREATE TABLE IF NOT EXISTS screening_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criteria TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'completed', 'completed_with_errors')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screening_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES screening_batches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx')),
  file_url TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result JSONB,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  promoted_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screening_batches_user_created
  ON screening_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_screening_items_batch_status
  ON screening_items(batch_id, status, created_at);

CREATE OR REPLACE TRIGGER trg_screening_batches_updated
  BEFORE UPDATE ON screening_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_screening_items_updated
  BEFORE UPDATE ON screening_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
