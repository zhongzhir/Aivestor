-- ============================================================
-- 迁移 027：知识晋升改为"复制保留个人份"（架构文档 v1.1 第 3.4 节修订）
-- ============================================================
-- 依赖：迁移 022（visibility / promoted_by / promoted_at）。
-- 幂等：所有语句均可重复执行。
-- 个人版零影响：source_entry_id 默认 NULL，存量条目零回填、现有查询不受影响。
--
-- 设计：晋升不再原地改 visibility（移动），而是 INSERT 一份机构层副本。
--   个人层原记录永不变动；机构层副本通过 source_entry_id 关联回原记录。
--   ON DELETE CASCADE：原记录被删 ⇒ 其机构层副本一并删除（避免悬挂副本）。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本列的代码。
--   仅新增列，不创建新表，沿用 knowledge_base_entries 既有授权，无新增 GRANT。
-- ============================================================

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS source_entry_id UUID
    REFERENCES knowledge_base_entries(id) ON DELETE CASCADE;

-- 防重复晋升与去重检索均按 source_entry_id 查找副本；只索引副本行。
CREATE INDEX IF NOT EXISTS idx_kb_source_entry
  ON knowledge_base_entries(source_entry_id)
  WHERE source_entry_id IS NOT NULL;
