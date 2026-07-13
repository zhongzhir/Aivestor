-- 迁移 039：结构化投后指标
-- 文本识别仍作为线索保留，正式指标由用户确认后按周期保存。

CREATE TABLE IF NOT EXISTS post_investment_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  metric_name TEXT NOT NULL,
  value_numeric NUMERIC NOT NULL,
  unit TEXT,
  period TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'update', 'document')),
  source_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_metrics_project
  ON post_investment_metrics(project_id, metric_name, period DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_org
  ON post_investment_metrics(org_id) WHERE org_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_post_metrics_updated
  BEFORE UPDATE ON post_investment_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
