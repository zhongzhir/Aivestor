-- ============================================================
-- 迁移 018：免费额度唯一键从 phone 改为 user_id
--   - 支持邮箱注册用户（无手机号）也能使用免费额度
--   - phone 列保留（历史数据兼容），但放宽为可空
--   - 默认额度调整为 500 万 tokens
-- 幂等：可重复执行。
-- 说明：执行前请确认 free_quota_usage 中不存在重复 user_id，
--       否则 ADD UNIQUE(user_id) 会失败（正常情况下每个 user_id 唯一）。
-- ============================================================

-- 1. 删除原 phone 唯一约束
ALTER TABLE free_quota_usage DROP CONSTRAINT IF EXISTS free_quota_usage_phone_key;

-- 2. phone 放宽为可空（邮箱用户没有手机号）
ALTER TABLE free_quota_usage ALTER COLUMN phone DROP NOT NULL;

-- 3. 新增 user_id 唯一约束（幂等：已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_quota_usage_user_id_key'
  ) THEN
    ALTER TABLE free_quota_usage
      ADD CONSTRAINT free_quota_usage_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 4. 默认额度 1000 万 → 500 万（仅影响后续新建行；存量行不变）
ALTER TABLE free_quota_usage ALTER COLUMN tokens_limit SET DEFAULT 5000000;
