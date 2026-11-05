BEGIN;

ALTER TABLE intelligence_run_external_attempts
  DROP CONSTRAINT IF EXISTS intelligence_run_external_attempts_provider_check;
ALTER TABLE intelligence_run_external_attempts
  DROP CONSTRAINT IF EXISTS intelligence_run_external_attempts_capability_check;

ALTER TABLE intelligence_run_external_attempts
  ADD CONSTRAINT intelligence_run_external_attempts_provider_check
    CHECK (provider IN ('deepseek-web', 'deepseek'));
ALTER TABLE intelligence_run_external_attempts
  ADD CONSTRAINT intelligence_run_external_attempts_capability_check
    CHECK (capability IN ('search', 'fetch', 'generation'));

ALTER TABLE intelligence_run_external_attempts
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS input_token_upper_bound INTEGER CHECK (input_token_upper_bound IS NULL OR input_token_upper_bound > 0),
  ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
  ADD COLUMN IF NOT EXISTS actual_input_tokens INTEGER CHECK (actual_input_tokens IS NULL OR actual_input_tokens >= 0),
  ADD COLUMN IF NOT EXISTS actual_output_tokens INTEGER CHECK (actual_output_tokens IS NULL OR actual_output_tokens >= 0),
  ADD COLUMN IF NOT EXISTS price_snapshot_id TEXT;

COMMENT ON COLUMN intelligence_run_external_attempts.price_snapshot_id IS
  '非秘密的固定价格快照标识；不得保存凭据、prompt、查询、正文或供应商响应。';

COMMIT;
