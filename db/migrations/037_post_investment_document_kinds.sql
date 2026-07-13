-- ============================================================
-- 迁移 037：投后材料文档分类
-- ============================================================
-- 为投后管理补充定期报告和治理会议材料分类。
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_doc_kind_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_doc_kind_check
  CHECK (
    doc_kind IN (
      'bp',
      'research',
      'contract',
      'financial_model',
      'news',
      'other',
      'post_financial_report',
      'post_audit_report',
      'post_operating_report',
      'post_board_material',
      'post_shareholder_material'
    )
  );
