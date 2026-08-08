-- 迁移 046：保存情报简报概览与来源管线元数据
ALTER TABLE intelligence_briefs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
