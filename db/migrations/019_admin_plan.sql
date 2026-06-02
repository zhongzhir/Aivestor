-- 019_admin_plan.sql
-- 放宽 users.plan 的 CHECK 约束以支持 'admin'，用于管理后台权限控制。
--
-- 注：CONTEXT 描述里出现过 free / pro / enterprise 的字段值，但实际生效
-- 的 schema.sql 是 personal / pro / team，因此这里取并集 + admin。

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

ALTER TABLE users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('personal', 'pro', 'team', 'admin'));
