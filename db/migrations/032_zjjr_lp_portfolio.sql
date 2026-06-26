-- LP 表
CREATE TABLE IF NOT EXISTS zjjr_lp (
  id                    SERIAL PRIMARY KEY,
  region                TEXT NOT NULL,
  name                  TEXT NOT NULL,
  committed_amount_yuan NUMERIC,          -- 单位：元（列名写"亿"是误导，实际是元）
  fund_count            INTEGER,
  established_date      DATE,
  registered_capital_wan NUMERIC,         -- 单位：万元
  latest_invest_date    DATE,
  register_location     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 被投标的主表（实体去重，一家公司一行）
CREATE TABLE IF NOT EXISTS zjjr_portfolio (
  id               SERIAL PRIMARY KEY,
  region           TEXT NOT NULL,
  city_district    TEXT,
  name             TEXT NOT NULL,
  industry         TEXT,
  established_date DATE,
  address          TEXT,
  register_location TEXT,
  listing_status   TEXT,
  legal_rep        TEXT,
  business_scope   TEXT,
  patent_name      TEXT,
  latest_invest_date DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_zjjr_lp_region   ON zjjr_lp(region);
CREATE INDEX IF NOT EXISTS idx_zjjr_lp_name      ON zjjr_lp(name);
CREATE INDEX IF NOT EXISTS idx_zjjr_portfolio_region   ON zjjr_portfolio(region);
CREATE INDEX IF NOT EXISTS idx_zjjr_portfolio_industry ON zjjr_portfolio(industry);
CREATE INDEX IF NOT EXISTS idx_zjjr_portfolio_city     ON zjjr_portfolio(city_district);
CREATE INDEX IF NOT EXISTS idx_zjjr_portfolio_name     ON zjjr_portfolio(name);

-- 权限
GRANT ALL PRIVILEGES ON zjjr_lp TO zjjr_sync;
GRANT ALL PRIVILEGES ON zjjr_portfolio TO zjjr_sync;
GRANT USAGE, SELECT ON SEQUENCE zjjr_lp_id_seq TO zjjr_sync;
GRANT USAGE, SELECT ON SEQUENCE zjjr_portfolio_id_seq TO zjjr_sync;
GRANT SELECT ON zjjr_lp TO aivestor;
GRANT SELECT ON zjjr_portfolio TO aivestor;
