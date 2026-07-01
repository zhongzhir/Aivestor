-- ============================================================
-- Migration 034: ZJJR GP due-diligence report archive
-- ============================================================
-- Public ZJJR data layer. These reports are not user/private knowledge
-- and are not org knowledge. They are archived here, then chunked into
-- zjjr_features for AI retrieval/injection.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS zjjr_gp_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id     UUID NULL REFERENCES zjjr_institutions(id) ON DELETE SET NULL,
  institution_name   TEXT NOT NULL,
  report_date        DATE NULL,
  region             TEXT NULL,
  source_batch       TEXT NOT NULL,
  source_file_name   TEXT NOT NULL,
  source_file_hash   TEXT NOT NULL UNIQUE,
  raw_text           TEXT NOT NULL,
  text_length        INTEGER NOT NULL,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_gp_reports_institution_id
  ON zjjr_gp_reports(institution_id);

CREATE INDEX IF NOT EXISTS idx_zjjr_gp_reports_institution_name_trgm
  ON zjjr_gp_reports USING GIN (institution_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_zjjr_gp_reports_source_batch
  ON zjjr_gp_reports(source_batch);

CREATE OR REPLACE TRIGGER trg_zjjr_gp_reports_updated
  BEFORE UPDATE ON zjjr_gp_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- zjjr_features originally only allowed four feature kinds. Add a dedicated
-- kind for GP report chunks while preserving existing values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'zjjr_features_feature_kind_check'
       AND conrelid = 'zjjr_features'::regclass
  ) THEN
    ALTER TABLE zjjr_features DROP CONSTRAINT zjjr_features_feature_kind_check;
  END IF;
END $$;

ALTER TABLE zjjr_features
  ADD CONSTRAINT zjjr_features_feature_kind_check
  CHECK (feature_kind IN (
    'institution_profile',
    'sector_trend',
    'investment_preference',
    'activity_summary',
    'gp_due_diligence_report'
  ));

-- zjjr_sync_log is operational metadata. Extend the enum-like CHECK so this
-- import can be recorded without overloading full/features_rebuild.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'zjjr_sync_log_sync_type_check'
       AND conrelid = 'zjjr_sync_log'::regclass
  ) THEN
    ALTER TABLE zjjr_sync_log DROP CONSTRAINT zjjr_sync_log_sync_type_check;
  END IF;
END $$;

ALTER TABLE zjjr_sync_log
  ADD CONSTRAINT zjjr_sync_log_sync_type_check
  CHECK (sync_type IN (
    'institutions',
    'investments',
    'full',
    'features_rebuild',
    'gp_detail_doc_import'
  ));

GRANT SELECT ON zjjr_gp_reports TO aivestor;
GRANT ALL PRIVILEGES ON zjjr_gp_reports TO zjjr_sync;
