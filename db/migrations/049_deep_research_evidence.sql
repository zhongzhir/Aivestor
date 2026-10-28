-- 深度投研 P1：保存原始材料定位表和结构化证据底稿/质量门禁。
-- source_map 不伪造定位：PDF/OCR=页，PPT=幻灯片，Excel=工作表/单元格范围，Word=段落范围。

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_map JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS research_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN documents.source_map IS
  '解析时保留的可回放来源定位；包含 locator、类型、标签和对应原文。';

COMMENT ON COLUMN reports.research_metadata IS
  '深度投研结构化证据底稿、框架类型及质量门禁结果。';
