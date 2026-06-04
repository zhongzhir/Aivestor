-- 迁移 017：user_profiles 新增结构化筛选标准字段（#20 快速粗筛）
-- 幂等：可重复执行。
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS screening_criteria JSONB NOT NULL
    DEFAULT '{"hard_pass": [], "preferred_stages": [], "preferred_sectors": []}'::jsonb;

COMMENT ON COLUMN user_profiles.screening_criteria IS
  '结构化筛选标准：hard_pass=硬否决项数组，preferred_stages=偏好阶段，preferred_sectors=偏好赛道';
