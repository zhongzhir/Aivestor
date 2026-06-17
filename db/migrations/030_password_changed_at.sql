-- ============================================================
-- 迁移 030：密码重置后会话失效支撑列（审计修复 F-06）
-- ============================================================
-- 背景：会话策略为无状态 JWT（auth.ts），重置密码原先只改 password_hash，
--   不吊销已签发的会话——账号被盗后受害者改密，攻击者旧 token 仍有效到自然过期。
--
-- 方案：users 表加 password_changed_at。改密/重置密码成功时置为 now()；
--   auth.ts 的 jwt 回调比对 password_changed_at 与 token.iat，
--   token 为改密前签发则使会话失效。
--
-- 编号：现有最大编号为 029，本迁移续号 030（与生产保持单调）。
-- 幂等：ADD COLUMN IF NOT EXISTS，可重复执行。
-- 注意：本迁移需在生产库【手动执行】。
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_changed_at IS
  '最近一次密码变更时间；jwt 回调据此使改密前签发的 JWT 会话失效（审计 F-06）。NULL=从未改密。';
