-- 迁移 018：reports 表新增 kind 字段，区分报告类型
-- 幂等：可重复执行。
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'analysis';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_kind_check'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_kind_check
      CHECK (kind IN ('analysis', 'brief', 'term_sheet'));
  END IF;
END$$;

COMMENT ON COLUMN reports.kind IS 'analysis=正式分析报告, brief=简要分析, term_sheet=Term Sheet初稿';

-- 补全历史数据：按 title 前缀回填 kind
UPDATE reports SET kind = 'brief'
WHERE kind = 'analysis' AND title LIKE '【简要分析】%';

UPDATE reports SET kind = 'term_sheet'
WHERE kind = 'analysis' AND title LIKE '【Term Sheet 初稿】%';
