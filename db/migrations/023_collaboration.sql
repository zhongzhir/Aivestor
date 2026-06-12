-- ============================================================
-- 迁移 023：轻协作 — 项目评论 + 项目共享 + 投委会总报告 kind 标识
--           （架构文档 v1.1 第 4.2 / 4.4 节）
-- ============================================================
-- 依赖：迁移 021（projects.org_id / owner_id）、迁移 018（reports.kind）。
-- 幂等：所有语句均可重复执行。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本表/约束的代码。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 项目评论（单层回复，仅组织项目可评论）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  -- 单层回复（不做无限嵌套）：指向被回复的顶层评论
  reply_to    UUID REFERENCES project_comments(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project
  ON project_comments(project_id, created_at DESC);

CREATE OR REPLACE TRIGGER trg_project_comments_updated
  BEFORE UPDATE ON project_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. 最简项目共享（只有"可见+可编辑"一档，不做权限细分）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_project_shares_user
  ON project_shares(shared_with);

-- ------------------------------------------------------------
-- 3. 投委会总报告结构化标识（v1.1 修订项 1）
-- 现状 merge 产物仅靠标题前缀【总报告】区分（reports/merge/route.ts，
-- kind 走默认 'analysis'），标题可被 refine 改写，不能作为权限过滤依据。
-- 引入 kind='committee' 并回填存量行（回填方式与迁移 018 同模式）。
-- ------------------------------------------------------------
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN ('analysis', 'brief', 'term_sheet', 'committee'));

UPDATE reports SET kind = 'committee'
 WHERE kind = 'analysis' AND title LIKE '【总报告】%';

-- ------------------------------------------------------------
-- 回填核对（本迁移内联执行，输出两条计数；两者必须相等，否则停止部署）
--   committee_count：回填后 kind='committee' 的报告数量。
--   prefix_count   ：按原识别逻辑（标题前缀）应为总报告的数量。
-- 二者不一致，说明存在标题前缀被改写 / 非 analysis 原 kind 等边界情况，
-- 需人工核对后再决定是否补回填，**不一致时不要继续部署代码**。
-- 历史核查结论（截至 2026-06-12）：merge 产物自首个 commit(8fb1970) 起标题恒为
-- 「【总报告】」前缀，refine 不修改 title，代码库无任何 UPDATE reports SET title
-- 路径，故漏判范围预期为 0；本核对用于兜底确认。
-- ------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM reports WHERE kind = 'committee')              AS committee_count,
  (SELECT COUNT(*) FROM reports WHERE title LIKE '【总报告】%')        AS prefix_count;
