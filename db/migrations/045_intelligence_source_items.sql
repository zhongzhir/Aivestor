-- 迁移 045：高价值外部情报源采集结果
-- 外部来源优先；market_insights 仅作为既有内部数据的降级来源。

CREATE TABLE IF NOT EXISTS intelligence_source_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key      TEXT NOT NULL,
  source_name     TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'official',
  source_homepage TEXT NOT NULL,
  canonical_url   TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  published_at    TIMESTAMPTZ NOT NULL,
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  subjects        JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_hash        TEXT,
  UNIQUE (source_key, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_source_items_published
  ON intelligence_source_items(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_source_items_source_time
  ON intelligence_source_items(source_key, published_at DESC);

-- 采集器专用账号可写，主应用账号只读。
-- 兼容不同部署角色命名（aivestor / aivestor_app / zjjr_sync）；角色不存在时跳过，不报错。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zjjr_sync') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence_source_items TO zjjr_sync';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aivestor_app') THEN
    EXECUTE 'GRANT SELECT ON intelligence_source_items TO aivestor_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aivestor') THEN
    EXECUTE 'GRANT SELECT ON intelligence_source_items TO aivestor';
  END IF;
END $$;
