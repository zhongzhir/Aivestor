-- 迁移 040：投后报告模板、评审状态与导出历史

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN ('analysis', 'brief', 'term_sheet', 'committee', 'lp_report', 'post_investment'));

CREATE TABLE IF NOT EXISTS post_investment_report_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL DEFAULT 'internal_review'
    CHECK (template_key IN ('internal_review', 'lp_update', 'assoc_update')),
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'in_review', 'approved', 'archived')),
  period_start DATE,
  period_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_post_report_meta_updated
  BEFORE UPDATE ON post_investment_report_meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS post_investment_report_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('docx', 'pptx')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_report_meta_status
  ON post_investment_report_meta(review_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_report_exports_report
  ON post_investment_report_exports(report_id, created_at DESC);
