-- ============================================================
-- 迁移 021：存量资源表 org 化（架构文档 v1.1 第 2.2 节）
-- ============================================================
-- 依赖：迁移 020（orgs 表）。
-- 幂等：所有语句均可重复执行。
-- 个人版零影响：所有列 NULL 默认、无回填、无 NOT NULL 约束，存量行 org_id IS NULL，
--   现有 WHERE user_id = $1 查询语义不受任何影响（纯 ADD COLUMN 为 catalog-only 操作，
--   不重写表、不长锁）。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本表列的代码。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 加列
-- ------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
-- 项目负责人（第四部分 4.1）：analyst 可见性判定依据。创建组织项目时 = 创建者。
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE post_investment_updates
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

ALTER TABLE user_custom_skills
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2. 部分索引：只索引机构行（org_id IS NOT NULL）。
-- 个人行（存量绝大多数，org_id IS NULL）零索引开销、写入路径无新增维护成本。
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_owner
  ON projects(org_id, owner_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_org
  ON documents(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_org
  ON knowledge_base_entries(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_org
  ON reports(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_judgments_org_project
  ON investment_judgments(org_id, project_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_org
  ON meeting_notes(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_updates_org
  ON post_investment_updates(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_skills_org
  ON user_custom_skills(org_id) WHERE org_id IS NOT NULL;
