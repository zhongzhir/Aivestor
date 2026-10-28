-- 迁移 048：新增单项目深度投研报告类型。
-- 深度投研复用 reports 的版本、权限、归档与导出链路，仅增加可区分的 kind。

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_kind_check
  CHECK (kind IN (
    'analysis',
    'deep_research',
    'brief',
    'term_sheet',
    'committee',
    'lp_report',
    'post_investment'
  ));

COMMENT ON COLUMN reports.kind IS
  'analysis=标准分析报告, deep_research=单项目深度投研报告, brief=简要分析, term_sheet=Term Sheet初稿, committee=投委会总报告, lp_report=LP报告, post_investment=投后报告';
