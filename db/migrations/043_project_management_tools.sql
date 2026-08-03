-- 迁移 043：轻量项目管理工具（分类、多标签、重点标记）
-- 个人项目使用 user_id；机构项目使用 org_id。存量项目默认未分类、无标签、非重点。

CREATE TABLE IF NOT EXISTS project_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID REFERENCES orgs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL)::int + (org_id IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_categories_user_name
  ON project_categories(user_id, normalized_name) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_categories_org_name
  ON project_categories(org_id, normalized_name) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID REFERENCES orgs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL)::int + (org_id IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_tags_user_name
  ON project_tags(user_id, normalized_name) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_tags_org_name
  ON project_tags(org_id, normalized_name) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_tag_links (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES project_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, tag_id)
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES project_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(is_priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_tag_links_tag ON project_tag_links(tag_id, project_id);

CREATE OR REPLACE TRIGGER trg_project_categories_updated
  BEFORE UPDATE ON project_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_project_tags_updated
  BEFORE UPDATE ON project_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
