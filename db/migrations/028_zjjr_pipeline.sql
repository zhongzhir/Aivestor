-- ============================================================
-- 迁移 028：中鉴数据管道 — 公共数据层（物理隔离）
--           （架构文档 v1.1 第五部分 5.1 / 5.2；P5 数据管道骨架）
-- ============================================================
-- 红线（架构文档 3.2 / 5.2）：
--   ① 本组表与业务表【无外键、无 JOIN 写路径】；
--   ② 主应用数据库账号对本组表【仅 GRANT SELECT】（见文件末尾「人工执行」段）；
--   ③ 唯一写入者为独立同步服务（专用账号 zjjr_sync，对本组表全权限、对业务表零权限）。
--
-- 编号说明：架构文档原稿将本迁移记为 024，但 020–023 之后生产实际已顺延使用
--   026/027，故本迁移取现有最大编号之后的 028（024/025 跳号，与生产保持单调）。
--
-- 幂等：所有语句均可重复执行（IF NOT EXISTS / OR REPLACE）。
-- 注意：本迁移【不自动执行】，需在生产库手动执行后，才能部署/运行依赖本组表的
--   同步服务与 zjjr 层检索代码（迁移先行纪律，见架构文档 0 现状基线）。
-- ============================================================

-- 机构名点查的模糊搜索依赖（5.1 / resolve.ts 实体解析的 pg_trgm 相似度匹配）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- 1. 投资机构主数据 zjjr_institutions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zjjr_institutions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 中鉴侧主键（增量同步对账键）
  source_id        TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  -- 实体解析后的规范名（消歧产物，检索展示用）
  canonical_name   TEXT NOT NULL,
  -- 同一机构的别名/曾用名（消歧累积）
  aliases          JSONB NOT NULL DEFAULT '[]'::jsonb,
  institution_type TEXT,            -- VC / PE / FA / CVC / 政府引导基金 等，留 TEXT 待 API 字典确认
  fund_count       INTEGER,
  manage_scale     TEXT,            -- 管理规模区间（中鉴口径，原样存）
  focus_sectors    JSONB NOT NULL DEFAULT '[]'::jsonb,
  focus_stages     JSONB NOT NULL DEFAULT '[]'::jsonb,
  region           TEXT,
  reg_status       TEXT,            -- 协会登记状态
  raw              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 中鉴原始记录全量留存
  -- 消歧元数据：pending_merge 候选（pg_trgm 相似度 > 0.85，进人工复核，不自动合并；
  -- 见 5.4 resolve.ts）。形如 {"pending_merge":[{"candidateId":"...","similarity":0.9}]}
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at TIMESTAMPTZ,    -- 中鉴侧更新时间（增量水位）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_inst_canonical
  ON zjjr_institutions(canonical_name);
-- 点查模糊搜索（需 pg_trgm 扩展，已在文件头创建）
CREATE INDEX IF NOT EXISTS idx_zjjr_inst_name_trgm
  ON zjjr_institutions USING GIN (name gin_trgm_ops);

CREATE OR REPLACE TRIGGER trg_zjjr_inst_updated
  BEFORE UPDATE ON zjjr_institutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. 投资事件 zjjr_investments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zjjr_investments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        TEXT NOT NULL UNIQUE,
  institution_id   UUID NOT NULL REFERENCES zjjr_institutions(id) ON DELETE CASCADE,
  target_company   TEXT NOT NULL,
  sector           TEXT,
  stage            TEXT,            -- 轮次
  amount_text      TEXT,            -- 金额原文（"数千万人民币"类非结构化口径，原样存）
  invested_at      DATE,
  co_investors     JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw              JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_inv_institution ON zjjr_investments(institution_id);
CREATE INDEX IF NOT EXISTS idx_zjjr_inv_sector      ON zjjr_investments(sector);
CREATE INDEX IF NOT EXISTS idx_zjjr_inv_date        ON zjjr_investments(invested_at DESC);

CREATE OR REPLACE TRIGGER trg_zjjr_inv_updated
  BEFORE UPDATE ON zjjr_investments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. 特征层 zjjr_features（自然语言化后的可检索知识片段，AI 注入的唯一读取面）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zjjr_features (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 特征种类：机构画像 / 赛道动态 / 投资偏好 / 活跃度
  feature_kind     TEXT NOT NULL
                     CHECK (feature_kind IN (
                       'institution_profile', 'sector_trend',
                       'investment_preference', 'activity_summary'
                     )),
  institution_id   UUID REFERENCES zjjr_institutions(id) ON DELETE CASCADE,
  sector           TEXT,
  title            TEXT NOT NULL,
  -- 自然语言化正文（注入 prompt 的内容主体）
  content          TEXT NOT NULL,
  embedding        VECTOR(1536),    -- 与业务侧同一嵌入模型（百炼 text-embedding-v4）
  -- 数据截止日（注入标注用）与有效期（过期降权，见 5.5）
  data_as_of       DATE NOT NULL,
  valid_until      DATE NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zjjr_features_kind  ON zjjr_features(feature_kind);
CREATE INDEX IF NOT EXISTS idx_zjjr_features_inst  ON zjjr_features(institution_id);
CREATE INDEX IF NOT EXISTS idx_zjjr_features_valid ON zjjr_features(valid_until);

-- ⚠️ 注意：embedding 的 ivfflat 索引【刻意不在本迁移创建】。
--   ivfflat 的聚类中心在建索引时一次性确定；空表 / 小样本时建索引会导致聚类中心
--   不具代表性、召回质量差。该索引由同步服务在【首次全量导入完成后】创建：
--
--     CREATE INDEX IF NOT EXISTS idx_zjjr_features_embedding ON zjjr_features
--       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--
--   （建索引时机：首次全量导入完成、zjjr_features 已有足够样本后执行。
--    日常增量写入由索引自动维护；features_rebuild 大批量重灌后需
--    `REINDEX INDEX idx_zjjr_features_embedding;` 重算聚类中心。）

CREATE OR REPLACE TRIGGER trg_zjjr_features_updated
  BEFORE UPDATE ON zjjr_features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 4. 同步日志 zjjr_sync_log（增量水位 + 运维排障）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zjjr_sync_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type        TEXT NOT NULL
                     CHECK (sync_type IN ('institutions', 'investments', 'full', 'features_rebuild')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'success', 'failed')),
  records_fetched  INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  -- 本次同步推进到的增量水位（下次 updated_since 的取值）
  watermark        TIMESTAMPTZ,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_zjjr_sync_log_type
  ON zjjr_sync_log(sync_type, started_at DESC);

-- ============================================================
-- 【人工执行 — 不在本迁移内自动跑，部署时由 DBA 手动落实】
-- ============================================================
-- 1) 同步服务专用账号（对 zjjr_* 全权限，对业务表零权限——双向隔离）：
--
--      CREATE USER zjjr_sync WITH PASSWORD '<改我>';
--      GRANT SELECT, INSERT, UPDATE, DELETE
--        ON zjjr_institutions, zjjr_investments, zjjr_features, zjjr_sync_log
--        TO zjjr_sync;
--      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zjjr_sync;  -- 如有
--      -- 不授予 zjjr_sync 对任何业务表（users/projects/... ）的权限。
--
-- 2) 主应用账号（默认 DATABASE_URL 所用账号，如 aivestor_app）对 zjjr_* 仅读：
--
--      GRANT SELECT
--        ON zjjr_institutions, zjjr_investments, zjjr_features
--        TO aivestor_app;
--      -- 不授予主应用对 zjjr_* 的写权限（隔离红线 3.2①）。
--      -- 主应用不读 zjjr_sync_log（运维表），可不授予。
-- ============================================================
