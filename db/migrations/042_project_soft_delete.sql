-- 项目软删除：用户侧隐藏，数据库保留完整项目及其关联数据。
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_user_live
  ON projects(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_live
  ON projects(org_id, updated_at DESC)
  WHERE deleted_at IS NULL;
