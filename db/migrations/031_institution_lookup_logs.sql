-- ============================================================
-- 迁移 031：机构点查频控日志（审计修复 F-02）
-- ============================================================
-- 背景：原频控在进程内 Map（src/lib/dataAppRateLimit.ts），PM2 多实例不共享
--   计数（N 实例=N 倍配额）、进程重启清零、且仅按 user_id 单维度，多账号可放大。
--
-- 方案：改为 DB 计数。每次点查 INSERT 一行；按 user_id 与 ip_address 分别统计
--   最近 1 小时行数，任一超过 60 即拒绝（复合 key 取更严格者）。
--
-- 编号：现有最大编号为 030，本迁移续号 031（与生产保持单调）。
-- 幂等：CREATE TABLE/INDEX IF NOT EXISTS，可重复执行。
-- 注意：本迁移需在生产库【手动执行】。
-- ============================================================

CREATE TABLE IF NOT EXISTS institution_lookup_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 频控统计：按 user_id / ip_address 取最近 1 小时窗口
CREATE INDEX IF NOT EXISTS idx_inst_lookup_user
  ON institution_lookup_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inst_lookup_ip
  ON institution_lookup_logs(ip_address, created_at);
