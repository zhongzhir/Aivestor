-- 迁移 038：投后行动项与退出策略
-- 将投后管理中需要持续维护的行动和退出判断从自由文本中独立出来。

CREATE TABLE IF NOT EXISTS post_investment_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  owner TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'meeting', 'update')),
  source_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_actions_project
  ON post_investment_action_items(project_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_post_actions_org
  ON post_investment_action_items(org_id) WHERE org_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_post_actions_updated
  BEFORE UPDATE ON post_investment_action_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS post_investment_exit_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  primary_path TEXT NOT NULL DEFAULT '',
  alternative_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_window TEXT,
  valuation_note TEXT,
  return_note TEXT,
  status TEXT NOT NULL DEFAULT 'monitoring'
    CHECK (status IN ('monitoring', 'preparing', 'executing', 'completed', 'paused')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_exit_org
  ON post_investment_exit_strategies(org_id) WHERE org_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_post_exit_updated
  BEFORE UPDATE ON post_investment_exit_strategies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
