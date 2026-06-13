-- ============================================================
-- 迁移 026：reports 支持 LP 报告（架构文档 v1.1 第 7.3 节）
-- ============================================================
-- 幂等：可重复执行。
-- 注意：本迁移需在生产库手动执行后，才能部署依赖本约束的代码。
--
-- ① kind CHECK 纳入 'lp_report'；CHECK 重建时含全部既有值
--    （'committee' 由迁移 023 引入，不可遗漏，否则存量行违反约束）。
-- ② project_id 放宽为可空：lp_report 聚合组合层数据，挂 org_id 维度，不挂单一项目。
--    应用层不变量（不依赖 DB 约束）：仅 kind='lp_report' 允许 project_id IS NULL；
--    其余 kind 全部经 /api/projects/[id]/... 创建，project_id 来自路由参数天然非空。
-- ============================================================

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN ('analysis', 'brief', 'term_sheet', 'committee', 'lp_report'));

ALTER TABLE reports ALTER COLUMN project_id DROP NOT NULL;

COMMENT ON COLUMN reports.kind IS
  'analysis=正式分析报告, brief=简要分析, term_sheet=Term Sheet初稿, committee=投委会总报告, lp_report=LP报告(project_id 为空, 挂 org_id)';
