-- ============================================================
-- 迁移 020：组织与成员 — 机构版地基（架构文档 v1.1 第 1.1 节）
-- ============================================================
-- 依赖：set_updated_at() 函数、pgcrypto 扩展（schema.sql 已创建）。
-- 幂等：所有语句均可重复执行。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本表的代码。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 组织表 orgs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  -- 能力位：代码只认这里的开关，不认任何版本名（架构文档 1.3）
  capabilities  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 组织简介 / 备注（机构档案页展示用）
  description   TEXT,
  -- 组织 logo（对象存储路径，复用 documents.file_url 同一存储）
  logo_url      TEXT,
  -- 软停用：到期 / 违约时置 false，所有 org 功能立即不可用
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_orgs_updated
  BEFORE UPDATE ON orgs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. 组织成员表 org_members
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'analyst'
                  CHECK (role IN ('admin', 'partner', 'analyst')),
  -- 邀请人（追溯用，可空：首个 admin 无邀请人）
  invited_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- 一人一 org（初期硬约束，架构文档 1.1.1；放开多 org 时仅需删本索引）
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_single_org
  ON org_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);

CREATE OR REPLACE TRIGGER trg_org_members_updated
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. 邀请表 org_invitations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- 邀请标识：邮箱或手机号（与 users.email / users.phone 对应）
  identifier    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'analyst'
                  CHECK (role IN ('admin', 'partner', 'analyst')),
  invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一组织对同一身份同时只能有一条待处理邀请；
-- 历史状态行（revoked / expired / accepted）不限量。
-- 注意不能用 UNIQUE (org_id, identifier, status)：同一身份第二次被撤销/
-- 过期时会与既有 revoked / expired 行冲突（架构文档 v1.1 修订项 2）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_pending
  ON org_invitations(org_id, identifier) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invitations_identifier
  ON org_invitations(identifier, status);
