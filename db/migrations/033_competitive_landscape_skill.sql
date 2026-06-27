-- ============================================================
-- 迁移 033：竞争格局分析 SKILL（机构版 zjjr_data 专属）
-- ============================================================
-- 1. 为 skill_catalog 加两个可选列（幂等 IF NOT EXISTS）：
--    requires_capability：能力位门控（null = 所有人可用）
--    is_official：区分官方内置 vs 历史自动生成
-- 2. 插入"竞争格局分析"技能（去重幂等）
-- ============================================================

ALTER TABLE skill_catalog
  ADD COLUMN IF NOT EXISTS requires_capability TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

INSERT INTO skill_catalog
  (name, description, category, prompt_template, applicable_stages,
   sort_order, requires_capability, is_official)
SELECT
  '竞争格局分析',
  '基于中鉴备案数据，检索同赛道已投机构分布，输出竞争格局与白地分析',
  'analysis',
  '__competitive_landscape__',   -- 占位符，实际逻辑走专用 API route
  ARRAY['screening', 'due_diligence'],
  6,
  'zjjr_data',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM skill_catalog WHERE name = '竞争格局分析'
);
