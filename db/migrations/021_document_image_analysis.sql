-- ============================================================
-- 迁移 021：BP 图片识别结果持久化
--   documents.image_analysis：Qwen-VL 识别结果
--   结构：[{ "position": "第3页", "description": "..." }]
--   非 NULL 表示已识别过（含空数组），重新生成报告时直接复用，
--   不再重复调用 Qwen-VL，也不再弹确认弹窗。
-- 注：020 已被 orgs_and_members 占用，本迁移顺延为 021。
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS image_analysis JSONB;
