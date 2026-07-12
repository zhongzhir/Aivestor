-- 迁移 035：项目工作区 Phase 2 工作字段
-- 用于项目详情页展示和编辑下一步动作、截止时间、证据完整度与工作备注。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS next_action TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS next_action_due_at DATE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS evidence_completeness INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS workspace_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_evidence_completeness_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_evidence_completeness_check
      CHECK (evidence_completeness >= 0 AND evidence_completeness <= 100)
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN projects.next_action IS '项目工作区下一步动作';
COMMENT ON COLUMN projects.next_action_due_at IS '下一步动作截止日期';
COMMENT ON COLUMN projects.evidence_completeness IS '证据完整度，0-100';
COMMENT ON COLUMN projects.workspace_note IS '项目工作区备注';
