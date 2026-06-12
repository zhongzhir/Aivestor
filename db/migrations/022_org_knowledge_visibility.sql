-- ============================================================
-- 迁移 022：知识库可见性 — 机构沉淀层（架构文档 v1.1 第 3.1 节）
-- ============================================================
-- 依赖：迁移 021（knowledge_base_entries.org_id）。
-- 幂等：所有语句均可重复执行。
-- 个人版零影响：visibility 默认 'private'，存量条目零回填、行为不变。
-- 不变量（应用层与晋升接口共同维护）：visibility='org' ⇒ org_id IS NOT NULL。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本表列的代码。
-- ============================================================

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'org'));

-- 晋升追溯：谁在何时把条目分享到机构层（条目始终保留原 user_id 作为作者）
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

-- 机构层检索索引（向量检索的 WHERE 过滤靠它收敛；只索引机构沉淀行）
CREATE INDEX IF NOT EXISTS idx_kb_org_visible
  ON knowledge_base_entries(org_id, visibility)
  WHERE org_id IS NOT NULL AND visibility = 'org';
