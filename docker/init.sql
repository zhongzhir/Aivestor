-- ============================================================
-- 投资工作台 (Investment Workbench) — 核心数据库 Schema
-- PostgreSQL 14+ / pgvector（docker-compose 默认使用官方 pgvector/pgvector:pg16）
-- ============================================================
-- 设计原则：
--   1. 知识库为产品地基，所有文档与知识条目均归属单一用户（私有化）。
--   2. 嵌入向量维度默认 1536（兼容 OpenAI / 通义千问 text-embedding）。
--      若改用其他嵌入模型，需同步调整 vector(N) 维度并重建索引。
--   3. 平台不存储任何 AI 服务 API Key，故无相关表。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- 自动维护 updated_at 的触发器函数
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 1. 用户表 users
--    一级股权投资专业人员账号。MVP 阶段仅个人版。
-- ------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  -- 邮箱+密码注册用户存 bcrypt 哈希；OAuth（GitHub）登录用户为 NULL
  password_hash TEXT,
  -- 注册来源：credentials（邮箱密码）/ github（OAuth）
  auth_provider TEXT NOT NULL DEFAULT 'credentials'
                  CHECK (auth_provider IN ('credentials', 'github')),
  image_url     TEXT,
  -- 版本：personal(个人版) / pro(专业版) / team(团队版)
  plan          TEXT NOT NULL DEFAULT 'personal'
                  CHECK (plan IN ('personal', 'pro', 'team')),
  -- 用户偏好的 AI 服务商（不含 Key）：deepseek / claude / qwen
  preferred_provider TEXT DEFAULT 'deepseek'
                  CHECK (preferred_provider IN ('deepseek', 'claude', 'qwen')),
  -- AI API Key（AES-256-GCM 密文，格式 iv:authTag:ciphertext）与对应服务商
  api_key_encrypted TEXT,
  ai_provider   TEXT DEFAULT 'deepseek',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. 项目表 projects
--    一个待评估/已投的投资标的。承载「功能2：投资分析报告生成」。
-- ------------------------------------------------------------
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,              -- 项目名称
  company_name  TEXT,                       -- 公司主体名称
  industry      TEXT,                       -- 行业
  stage         TEXT,                       -- 融资轮次：天使/Pre-A/A/B...
  -- 项目状态：评估中 / 已投 / 已 Pass / 已退出
  status        TEXT NOT NULL DEFAULT 'evaluating'
                  CHECK (status IN ('evaluating', 'invested', 'passed', 'exited')),
  -- 用户输入的判断要点（3-10 条），结构化保存为 JSON 数组
  judgment_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- AI 从 BP 提取的结构化财务数据（见 FinancialData 类型）
  financial_data JSONB,
  summary       TEXT,                       -- 项目一句话概述
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user   ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(user_id, status);

CREATE TRIGGER trg_projects_updated
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. 文档表 documents
--    用户上传的原始材料（BP / 研究报告 / 合同 等）。
--    extracted_text 为解析后的纯文本，供 AI 与切片使用。
-- ------------------------------------------------------------
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 文档可独立上传至知识库，也可挂在某个项目下
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  -- 文件格式：pdf / docx / xlsx / image
  file_type     TEXT NOT NULL
                  CHECK (file_type IN ('pdf', 'docx', 'xlsx', 'image')),
  file_url      TEXT,                       -- 对象存储路径（S3 兼容）
  file_size     BIGINT,                     -- 字节
  -- 文档类型标签：bp / research / contract / financial_model / news / other
  doc_kind      TEXT NOT NULL DEFAULT 'other'
                  CHECK (doc_kind IN ('bp', 'research', 'contract',
                                      'financial_model', 'news', 'other')),
  extracted_text TEXT,                      -- 解析出的纯文本
  -- AI 自动 + 用户手动标签（行业/阶段/类型等）
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 解析状态：pending / processing / done / failed
  parse_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (parse_status IN ('pending', 'processing', 'done', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_user    ON documents(user_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_kind    ON documents(user_id, doc_kind);

CREATE TRIGGER trg_documents_updated
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 4. 知识库条目表 knowledge_base_entries
--    产品地基：文档切片 + 向量，支撑 RAG 检索增强生成。
--    每个用户的知识库完全私有、相互隔离。
-- ------------------------------------------------------------
CREATE TABLE knowledge_base_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 来源文档（切片来自哪个文档）
  source_document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  -- 关联项目（若该知识来自某项目）
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  -- 条目类型：对应 PRD 知识库分类
  --   industry  行业认图
  --   project   项目库（已投/未投/Pass）
  --   thesis    投资逻辑文档
  --   prediction 预测与复盘
  --   chunk     普通文档切片
  entry_type    TEXT NOT NULL DEFAULT 'chunk'
                  CHECK (entry_type IN ('industry', 'project', 'thesis',
                                        'prediction', 'chunk')),
  title         TEXT,
  content       TEXT NOT NULL,              -- 切片/条目正文
  -- 嵌入向量。维度需与所用嵌入模型一致（默认 1536）。
  embedding     VECTOR(1536),
  -- 结构化元数据（章节、页码、来源摘要等）
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_user    ON knowledge_base_entries(user_id);
CREATE INDEX idx_kb_doc     ON knowledge_base_entries(source_document_id);
CREATE INDEX idx_kb_type    ON knowledge_base_entries(user_id, entry_type);
-- 向量近似最近邻索引（余弦距离）。数据量大后可调整 lists 参数。
CREATE INDEX idx_kb_embedding ON knowledge_base_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ------------------------------------------------------------
-- 5. 报告表 reports（MVP 功能2 产物）
--    AI 生成的项目分析报告，支持多轮自然语言修改与版本留存。
-- ------------------------------------------------------------
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '项目分析报告',
  content       TEXT NOT NULL,              -- 当前正文（Markdown）
  version       INTEGER NOT NULL DEFAULT 1, -- 多轮修改的版本号
  -- 多轮修改对话记录：[{role, content, ts}, ...]
  revision_log  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 多轮修改指令历史：[{instruction, ts}, ...]
  conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'finalized')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_project ON reports(project_id);
CREATE INDEX idx_reports_user    ON reports(user_id);

CREATE TRIGGER trg_reports_updated
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 6. 投资判断记录表 investment_judgments
--    记录投资人在项目各阶段的判断、疑虑与决策依据。
--    这是知识库"经验内化"的核心——存储的不只是文档，
--    而是投资人的推理过程和决策逻辑，随时间形成认知演变时间线。
-- ------------------------------------------------------------
CREATE TABLE investment_judgments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 判断发生的阶段
  stage         TEXT NOT NULL DEFAULT 'initial'
                  CHECK (stage IN (
                    'initial',      -- 初次接触/看BP
                    'due_diligence',-- 尽调阶段
                    'decision',     -- 投决会
                    'post_invest',  -- 投后跟踪
                    'exit'          -- 退出复盘
                  )),
  -- 判断类型
  judgment_type TEXT NOT NULL DEFAULT 'note'
                  CHECK (judgment_type IN (
                    'thesis',       -- 投资逻辑
                    'concern',      -- 核心疑虑
                    'assumption',   -- 关键假设
                    'decision',     -- 最终决策及依据
                    'note'          -- 随手笔记
                  )),
  title         TEXT,                       -- 判断标题（可选）
  content       TEXT NOT NULL,              -- 判断正文
  -- 后续验证结果（投后复盘时填写）
  outcome       TEXT,
  -- 该判断是否已被知识库索引（向量化）
  is_indexed    BOOLEAN NOT NULL DEFAULT false,
  embedding     VECTOR(1536),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_judgments_user    ON investment_judgments(user_id);
CREATE INDEX idx_judgments_project ON investment_judgments(project_id);
CREATE INDEX idx_judgments_stage   ON investment_judgments(user_id, stage);
CREATE INDEX idx_judgments_type    ON investment_judgments(user_id, judgment_type);
CREATE INDEX idx_judgments_embedding ON investment_judgments
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TRIGGER trg_judgments_updated
  BEFORE UPDATE ON investment_judgments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 7. 会议记录表 meeting_notes
--    结构化存储投资人的会议记录（创始人访谈、专家访谈、投后会议等）。
--    独立于文档上传，支持快速录入和语义检索。
-- ------------------------------------------------------------
CREATE TABLE meeting_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,              -- 会议标题
  meeting_type  TEXT NOT NULL DEFAULT 'founder'
                  CHECK (meeting_type IN (
                    'founder',      -- 创始人访谈
                    'expert',       -- 专家访谈
                    'lp',           -- LP沟通
                    'post_invest',  -- 投后例会
                    'internal',     -- 内部讨论
                    'other'
                  )),
  meeting_date  DATE,                       -- 会议日期
  participants  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 参与者列表
  content       TEXT NOT NULL,              -- 会议记录正文（Markdown）
  key_points    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- AI提取的关键要点
  action_items  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 待办事项
  is_indexed    BOOLEAN NOT NULL DEFAULT false,
  embedding     VECTOR(1536),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_user    ON meeting_notes(user_id);
CREATE INDEX idx_meetings_project ON meeting_notes(project_id);
CREATE INDEX idx_meetings_type    ON meeting_notes(user_id, meeting_type);
CREATE INDEX idx_meetings_date    ON meeting_notes(user_id, meeting_date DESC);
CREATE INDEX idx_meetings_embedding ON meeting_notes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TRIGGER trg_meetings_updated
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 8. SKILL表 user_skills
--    记录用户安装/收藏的分析技能包。
--    早期SKILL来自外部（GitHub/GPTs），Vestia做聚合和策展。
-- ------------------------------------------------------------
CREATE TABLE user_skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name    TEXT NOT NULL,              -- 技能名称
  skill_slug    TEXT NOT NULL,              -- 唯一标识符
  description   TEXT,
  source_type   TEXT NOT NULL DEFAULT 'external'
                  CHECK (source_type IN (
                    'vestia',       -- Vestia官方出品
                    'community',    -- 社区贡献
                    'external'      -- 外部引入（GitHub/GPTs等）
                  )),
  source_url    TEXT,                       -- 外部来源链接
  -- 嵌入方式：link跳转 / embed内嵌 / api调用
  embed_type    TEXT NOT NULL DEFAULT 'link'
                  CHECK (embed_type IN ('link', 'embed', 'api')),
  embed_config  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 嵌入配置（URL等）
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_used_at  TIMESTAMPTZ,
  use_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_slug)
);

CREATE INDEX idx_skills_user   ON user_skills(user_id);
CREATE INDEX idx_skills_active ON user_skills(user_id, is_active);

CREATE TRIGGER trg_skills_updated
  BEFORE UPDATE ON user_skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 9. 知识库条目补充 updated_at
--    原 knowledge_base_entries 表缺少 updated_at，补充迁移。
-- ------------------------------------------------------------
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TRIGGER trg_kb_updated
  BEFORE UPDATE ON knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 迁移文件
-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/001_knowledge_extension.sql
-- ============================================================
-- 迁移 001：知识库 Schema 扩展
-- ============================================================
-- 在已初始化的数据库上增量应用，不触碰现有 5 张表。
--   新增：investment_judgments / meeting_notes / user_skills
--   补充：knowledge_base_entries.updated_at
-- 依赖：set_updated_at() 函数、vector 扩展（已由 schema.sql 创建）。
-- 幂等：所有语句均可重复执行（IF NOT EXISTS / OR REPLACE）。
-- ============================================================

-- ------------------------------------------------------------
-- 6. 投资判断记录表 investment_judgments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investment_judgments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL DEFAULT 'initial'
                  CHECK (stage IN (
                    'initial',
                    'due_diligence',
                    'decision',
                    'post_invest',
                    'exit'
                  )),
  judgment_type TEXT NOT NULL DEFAULT 'note'
                  CHECK (judgment_type IN (
                    'thesis',
                    'concern',
                    'assumption',
                    'decision',
                    'note'
                  )),
  title         TEXT,
  content       TEXT NOT NULL,
  outcome       TEXT,
  is_indexed    BOOLEAN NOT NULL DEFAULT false,
  embedding     VECTOR(1536),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judgments_user    ON investment_judgments(user_id);
CREATE INDEX IF NOT EXISTS idx_judgments_project ON investment_judgments(project_id);
CREATE INDEX IF NOT EXISTS idx_judgments_stage   ON investment_judgments(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_judgments_type    ON investment_judgments(user_id, judgment_type);
CREATE INDEX IF NOT EXISTS idx_judgments_embedding ON investment_judgments
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE TRIGGER trg_judgments_updated
  BEFORE UPDATE ON investment_judgments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 7. 会议记录表 meeting_notes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  meeting_type  TEXT NOT NULL DEFAULT 'founder'
                  CHECK (meeting_type IN (
                    'founder',
                    'expert',
                    'lp',
                    'post_invest',
                    'internal',
                    'other'
                  )),
  meeting_date  DATE,
  participants  JSONB NOT NULL DEFAULT '[]'::jsonb,
  content       TEXT NOT NULL,
  key_points    JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items  JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_indexed    BOOLEAN NOT NULL DEFAULT false,
  embedding     VECTOR(1536),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_user    ON meeting_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project ON meeting_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_type    ON meeting_notes(user_id, meeting_type);
CREATE INDEX IF NOT EXISTS idx_meetings_date    ON meeting_notes(user_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_embedding ON meeting_notes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE TRIGGER trg_meetings_updated
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 8. SKILL 表 user_skills
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name    TEXT NOT NULL,
  skill_slug    TEXT NOT NULL,
  description   TEXT,
  source_type   TEXT NOT NULL DEFAULT 'external'
                  CHECK (source_type IN (
                    'vestia',
                    'community',
                    'external'
                  )),
  source_url    TEXT,
  embed_type    TEXT NOT NULL DEFAULT 'link'
                  CHECK (embed_type IN ('link', 'embed', 'api')),
  embed_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_used_at  TIMESTAMPTZ,
  use_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_slug)
);

CREATE INDEX IF NOT EXISTS idx_skills_user   ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_active ON user_skills(user_id, is_active);

CREATE OR REPLACE TRIGGER trg_skills_updated
  BEFORE UPDATE ON user_skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 9. 知识库条目补充 updated_at
-- ------------------------------------------------------------
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE TRIGGER trg_kb_updated
  BEFORE UPDATE ON knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/002_knowledge_embedding.sql
-- ============================================================
-- 迁移 002：知识库补充 embedding_model / source_type / tags / 全文检索
-- ============================================================
-- 幂等：所有语句均可重复执行（IF NOT EXISTS）。
-- ============================================================

-- 记录条目使用的 embedding 模型
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- 条目来源类型（manual 手动录入 / document 项目文档 / report 分析报告 等）
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT;

-- 条目标签
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 全文检索向量（中英文混合，用 simple 配置兜底）
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_kb_search_vector
  ON knowledge_base_entries USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_kb_user_created
  ON knowledge_base_entries(user_id, created_at DESC);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/003_document_chunks.sql
-- ============================================================
-- 迁移 003：文档分块表 document_chunks
-- ============================================================
-- 将上传文档切分为 chunk 后分别向量化，提升语义检索精度。
-- 幂等：所有语句均可重复执行（IF NOT EXISTS）。
-- 依赖：vector 扩展（已由 schema.sql 创建）。
-- ============================================================

CREATE TABLE IF NOT EXISTS document_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  token_count  INTEGER,
  embedding    VECTOR(1536),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id
  ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id
  ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/004_cognition.sql
-- ============================================================
-- 迁移 004：认知演变 — 项目流程阶段 + 结构化判断记录
-- ============================================================
-- 注意：projects.stage 已用于「融资轮次」（天使/Pre-A/A...），
--       本迁移新增 process_stage 表示「投资流程阶段」，二者互不影响。
-- 幂等：所有语句均可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1. projects 新增投资流程阶段
--    screening 初筛 / due_diligence 尽调 / investment_committee 投委会
--    / post_investment 投后管理 / passed 已Pass / exited 已退出
-- ------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS process_stage TEXT NOT NULL DEFAULT 'screening';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS process_stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 2. investment_judgments 新增结构化判断字段
-- ------------------------------------------------------------
ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS bull_case TEXT;
ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS bear_case TEXT;
ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS founder_assessment TEXT;
ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS key_hypothesis TEXT;
ALTER TABLE investment_judgments
  ADD COLUMN IF NOT EXISTS confidence_level INTEGER
    CHECK (confidence_level IS NULL OR confidence_level BETWEEN 1 AND 5);

-- 结构化判断记录不一定有正文，content 改为可空
ALTER TABLE investment_judgments
  ALTER COLUMN content DROP NOT NULL;

-- 旧的 stage CHECK 仅允许 initial/due_diligence/decision/post_invest/exit，
-- 与新流程阶段不一致，去掉约束改由应用层校验。
ALTER TABLE investment_judgments
  DROP CONSTRAINT IF EXISTS investment_judgments_stage_check;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/005_judgments_constraints.sql
-- ============================================================
-- 迁移 005：修复 investment_judgments 残留约束
-- ============================================================
-- 背景：迁移 004 的列新增可能已应用，但放宽约束的语句未必生效。
--   - 旧 stage CHECK 仅允许 initial/due_diligence/decision/post_invest/exit，
--     插入 screening/investment_committee/passed/exited 会违反约束。
--   - content 原为 NOT NULL，结构化判断记录可能不带正文。
-- 幂等：可重复执行。
-- ============================================================

-- 去掉旧的 stage CHECK 约束（阶段值改由应用层校验）
ALTER TABLE investment_judgments
  DROP CONSTRAINT IF EXISTS investment_judgments_stage_check;

-- content 放宽为可空
ALTER TABLE investment_judgments
  ALTER COLUMN content DROP NOT NULL;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/006_document_filetypes.sql
-- ============================================================
-- 迁移 006：documents.file_type 支持 PPT / 旧版 Excel
-- ============================================================
-- 原 CHECK 仅允许 pdf/docx/xlsx/image，统一上传新增 pptx、xls，
-- 需放宽约束否则插入会违反 CHECK。
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_file_type_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_file_type_check
  CHECK (file_type IN ('pdf', 'docx', 'pptx', 'xlsx', 'xls', 'image'));

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/007_skill_market.sql
-- ============================================================
-- 迁移 007：SKILL 市场 — 官方 SKILL 目录 + 用户自建 SKILL
-- ============================================================
-- 幂等：建表与索引可重复执行；官方 SKILL 数据仅在表为空时插入。
-- ============================================================

-- SKILL 目录表（官方内置）
CREATE TABLE IF NOT EXISTS skill_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(30) CHECK (category IN ('analysis', 'due_diligence', 'valuation', 'post_investment')),
  prompt_template TEXT NOT NULL,
  input_variables JSONB DEFAULT '[]',
  applicable_stages VARCHAR[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 用户自建 SKILL
CREATE TABLE IF NOT EXISTS user_custom_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(30),
  prompt_template TEXT NOT NULL,
  applicable_stages VARCHAR[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_custom_skills_user_id ON user_custom_skills(user_id);

-- 内置官方 SKILL 数据（仅在 skill_catalog 为空时插入，避免重复执行重复插入）
INSERT INTO skill_catalog (name, description, category, prompt_template, applicable_stages, sort_order)
SELECT * FROM (VALUES

-- 分析框架类
('波特五力分析',
'系统拆解行业竞争格局，识别真实壁垒与威胁来源',
'analysis',
'你是一位资深行业分析师。请对以下项目进行波特五力分析，要求具体、有据可查，避免泛泛而谈。

项目信息：
{project_info}

BP内容：
{bp_content}

请按以下五个维度逐一分析：

## 1. 现有竞争者威胁
主要竞争对手是谁？竞争激烈程度如何？差异化程度？

## 2. 新进入者威胁
进入壁垒高低？资金/技术/牌照/网络效应壁垒？

## 3. 替代品威胁
有哪些替代解决方案？用户切换成本？

## 4. 供应商议价能力
核心供应商集中度？依赖程度？是否有替代？

## 5. 买家议价能力
客户集中度？客户切换成本？价格敏感度？

## 综合判断
该行业的结构性吸引力如何？对这家公司最大的结构性威胁是什么？',
ARRAY['screening', 'due_diligence']::VARCHAR[],
1),

('SWOT 分析',
'四象限战略分析，识别优势、劣势、机会与威胁',
'analysis',
'请对以下项目进行深度 SWOT 分析，每个象限给出3-5个具体要点，并说明依据。

项目信息：
{project_info}

BP内容：
{bp_content}

## Strengths（优势）
内部核心竞争力是什么？护城河来自哪里？

## Weaknesses（劣势）
内部最显著的短板？当前阶段最危险的能力缺口？

## Opportunities（机会）
外部最大的市场机遇？时机窗口有多长？

## Threats（威胁）
外部最大的威胁？政策/竞争/技术替代哪个最危险？

## 战略建议
基于 SWOT，该公司现阶段最应该做什么、最应该避免什么？',
ARRAY['screening', 'due_diligence']::VARCHAR[],
2),

('商业模式画布',
'九宫格拆解商业模式，识别关键假设与薄弱环节',
'analysis',
'请用商业模式画布（Business Model Canvas）框架分析以下项目，重点识别关键假设和潜在薄弱点。

项目信息：
{project_info}

BP内容：
{bp_content}

请逐一分析九个模块：

1. **客户细分**：目标客户是谁？最核心的客群？
2. **价值主张**：为客户解决什么问题？差异化在哪里？
3. **渠道通路**：如何触达客户？获客效率如何？
4. **客户关系**：如何维系客户？留存机制是什么？
5. **收入来源**：收入模式？定价逻辑？付费意愿验证？
6. **核心资源**：最关键的资产是什么？难以复制的是什么？
7. **关键业务**：核心运营活动？最难做好的是什么？
8. **重要伙伴**：关键合作方？依赖程度？
9. **成本结构**：主要成本项？固定/变动比例？

## 关键假设识别
这个商业模式最依赖哪3个假设成立？如果其中一个被证伪，影响几何？',
ARRAY['screening', 'due_diligence']::VARCHAR[],
3),

('TAM/SAM/SOM 市场拆解',
'自上而下拆解市场规模，检验增长逻辑是否成立',
'analysis',
'请对以下项目的市场规模进行严格拆解，重点检验 BP 中的市场数据是否合理。

项目信息：
{project_info}

BP内容：
{bp_content}

## TAM（总目标市场）
BP 声称的 TAM 是多少？引用来源是否可信？是否存在高估？

## SAM（可服务市场）
实际可触达的细分市场规模？有哪些限制因素（地域/渠道/资质）？

## SOM（可获取市场）
3-5年内现实可获取的份额？依据是什么？

## 增长驱动力分析
市场增长的核心驱动力是什么？是真实需求增长还是渗透率提升？驱动力可持续吗？

## 市场规模合理性判断
综合来看，该公司对市场规模的描述是否可信？投资人应该用什么数字做模型假设？',
ARRAY['screening', 'due_diligence']::VARCHAR[],
4),

('竞争格局矩阵',
'系统梳理主要竞争对手，定位差异化空间',
'analysis',
'请对以下项目所在赛道进行竞争格局梳理，帮助判断该公司的差异化是否真实存在。

项目信息：
{project_info}

BP内容：
{bp_content}

## 主要竞争对手梳理
列出3-8个主要竞争对手，包括：
- 公司名称与融资阶段
- 核心产品/服务
- 主要客群
- 估计规模（GMV/ARR/用户数）

## 竞争维度对比
选择3-5个关键竞争维度（如价格/功能/渠道/品牌/技术），制作对比矩阵

## 差异化评估
该公司声称的差异化是否真实？竞争对手是否已经或即将做同样的事？

## 竞争风险判断
最危险的竞争威胁来自哪里？头部玩家如果跟进，该公司的护城河是否足够？',
ARRAY['screening', 'due_diligence']::VARCHAR[],
5),

('护城河评估',
'评估竞争壁垒的真实性与持续性',
'analysis',
'请对以下项目的竞争壁垒进行严格评估，判断护城河是否真实存在、能否持续。

项目信息：
{project_info}

BP内容：
{bp_content}

请逐一检验以下五种护城河是否存在：

## 1. 网络效应
是否存在？强度如何（本地/全国/全球）？双边还是单边？临界点在哪里？

## 2. 转换成本
用户迁移的成本有多高？数据/习惯/集成/合同锁定？竞品是否在降低转换成本？

## 3. 规模经济
随规模扩大，单位成本是否显著下降？竞争对手能否通过融资跨越规模门槛？

## 4. 无形资产
品牌/专利/牌照/独家数据？这些资产的壁垒强度如何？是否容易绕过？

## 5. 成本优势
是否有持续的成本结构优势？来源是技术/供应链/地理位置还是规模？

## 综合判断
该公司的护城河评级（强/中/弱）？最脆弱的地方在哪里？',
ARRAY['due_diligence', 'investment_committee']::VARCHAR[],
6),

('PEST 宏观分析',
'政治/经济/社会/技术四维度评估宏观环境',
'analysis',
'请对以下项目所处的宏观环境进行 PEST 分析，重点识别外部机遇与风险。

项目信息：
{project_info}

BP内容：
{bp_content}

## Political（政治/监管）
相关政策环境如何？监管趋势是收紧还是放开？有哪些政策风险？

## Economic（经济）
宏观经济对该业务的影响？经济下行时该业务的抗周期性？融资环境如何影响扩张？

## Social（社会）
目标用户群的行为趋势？人口结构变化的影响？社会文化对产品接受度的影响？

## Technological（技术）
技术趋势是助力还是威胁？AI/自动化对该行业的冲击程度？技术替代风险？

## 综合判断
宏观环境对该公司是顺风还是逆风？未来3年最大的宏观风险是什么？',
ARRAY['screening']::VARCHAR[],
7),

-- 尽调工具类
('创始人画像',
'从公开信息系统构建创始人能力与风险画像',
'due_diligence',
'你是一位专注早期投资的资深投资人，非常重视对创始团队的判断。请基于以下信息，对创始人/核心团队进行系统性画像分析。

项目信息：
{project_info}

BP内容（团队介绍部分）：
{bp_content}

## 背景核实要点
- 教育背景的真实性与含金量
- 过往工作经历中可验证的成就
- 行业人脉与资源网络
- 是否有过创业经历？结果如何？

## 能力评估
- 与当前业务最相关的核心能力是什么？
- 明显的能力缺口在哪里？
- 团队能力是否覆盖业务关键职能（产品/技术/销售/运营）？

## 风险信号
- 简历中有哪些信息值得深入核实？
- 团队稳定性风险？过往合伙人关系？
- 行事风格是否与融资阶段匹配？

## 访谈建议
列出5-8个在访谈中最值得深挖的问题，针对你发现的风险点。

## 综合判断
该团队的能力与这个项目的要求匹配度如何？最大的人的风险是什么？',
ARRAY['due_diligence']::VARCHAR[],
8),

('核心团队评估',
'评估核心团队完整性与执行力',
'due_diligence',
'请对以下项目的核心团队进行系统评估，判断团队是否具备执行当前战略的能力。

项目信息：
{project_info}

BP内容：
{bp_content}

## 团队完整性
当前阶段必须具备的关键角色是否到位？缺失的关键岗位是什么？

## 股权结构
创始团队股权分配是否合理？是否有明显的利益冲突隐患？期权池设置？

## 执行力信号
过去6-12个月的里程碑完成情况？说到做到的证据？

## 人才密度
核心团队成员的质量如何？是否有超出当前阶段预期的顶尖人才？

## 团队稳定性风险
核心成员的锁定情况？是否有潜在的离职风险？

## 建议补充尽调动作
列出3-5个需要进一步核实的关键信息点。',
ARRAY['due_diligence']::VARCHAR[],
9),

('财务异常检测',
'识别财务模型中的常见造假模式或逻辑错误',
'due_diligence',
'你是一位有丰富财务尽调经验的投资人，见过各种财务造假和模型错误。请对以下财务数据进行严格审查。

项目信息：
{project_info}

财务数据：
{financial_data}

BP内容（财务相关部分）：
{bp_content}

## 收入质量检验
- 收入确认方式是否激进？是否提前确认？
- 收入集中度（前五大客户占比）？
- 是否有明显的季节性异常？

## 利润率合理性
- 毛利率与同行相比是否异常偏高？
- 费用率趋势是否合理？是否有费用递延迹象？

## 现金流vs利润
- 净利润与经营现金流是否匹配？差距过大意味着什么？
- 应收账款周转天数趋势？是否在膨胀？

## 增长逻辑一致性
- 收入增长与其他经营指标（用户数/订单量/人员规模）是否匹配？
- 扩张期的资本开支与收入增长是否合理？

## 预测假设检验
- 未来3年增长预测的核心假设是什么？
- 哪个假设最脆弱？悲观情景下结果如何？

## 红旗清单
列出所有值得进一步核实的财务异常信号。',
ARRAY['due_diligence']::VARCHAR[],
10),

('客户访谈提纲',
'生成针对性的客户访谈问题，验证核心商业假设',
'due_diligence',
'请基于以下项目信息，生成一份高质量的客户访谈提纲，帮助验证最关键的商业假设。

项目信息：
{project_info}

BP内容：
{bp_content}

## 访谈目标
首先识别该项目最需要通过客户访谈验证的3个核心假设。

## 破冰问题（5分钟）
建立信任、了解受访者背景的开场问题。

## 痛点验证（15分钟）
深入了解客户真实痛点，验证产品解决的问题是否真实存在。

## 产品价值验证（15分钟）
了解客户对产品的真实评价，付费意愿，使用频率。

## 竞品对比（10分钟）
了解客户还在用什么替代方案，切换原因，满意度对比。

## 核心假设验证（10分钟）
针对你识别出的3个核心假设，设计直接验证问题。

## 红旗探测
设计3-5个能暴露潜在问题的问题（不直接问，侧面切入）。',
ARRAY['due_diligence']::VARCHAR[],
11),

('法律风险扫描',
'识别商业模式中的潜在法律合规风险',
'due_diligence',
'请对以下项目进行法律风险初步扫描，识别需要专业法律意见的关键风险点。注意：本分析仅供参考，不构成法律意见。

项目信息：
{project_info}

BP内容：
{bp_content}

## 经营资质合规
核心业务是否需要特定牌照或许可？当前持牌情况？未来监管趋势？

## 数据合规风险
是否涉及个人数据收集？数据存储和使用是否符合《个人信息保护法》？是否有跨境数据传输？

## 知识产权风险
核心技术是否有专利保护？是否存在侵权风险？创始人从前雇主带走的IP风险？

## 劳动用工合规
是否有大量灵活用工/外包？劳动关系认定风险？

## 商业模式合规
商业模式是否处于监管灰区？历史上类似模式是否被叫停过？

## 股权结构风险
VIE结构？境外架构？历史融资的优先清算权安排？

## 需要专业核查的事项
列出3-5个需要委托律师出具正式法律意见的核心问题。',
ARRAY['due_diligence']::VARCHAR[],
12),

('供应链风险评估',
'评估供应链稳定性与核心供应商依赖风险',
'due_diligence',
'请对以下项目的供应链进行风险评估。

项目信息：
{project_info}

BP内容：
{bp_content}

## 核心供应商依赖
前三大供应商的集中度？是否有单一供应商超过30%依赖？替代供应商准备情况？

## 供应链稳定性
历史上是否发生过供应中断？恢复能力如何？库存策略是否合理？

## 成本波动风险
原材料/能源价格波动对成本结构的影响？是否有对冲机制？

## 地缘政治风险
供应链是否涉及敏感地区？是否面临出口管制风险？

## 质量控制
供应商质量管控机制？历史上的质量问题？

## 供应链改善建议
如果投资后需要优化供应链，优先级最高的改善点是什么？',
ARRAY['due_diligence']::VARCHAR[],
13),

-- 估值决策类
('估值合理性检验',
'对标同类公司，检验估值假设是否成立',
'valuation',
'你是一位有丰富投资经验的合伙人，正在参加投委会讨论。请对以下项目的估值进行严格检验。

项目信息：
{project_info}

财务数据：
{financial_data}

BP内容：
{bp_content}

## 估值倍数分析
当前估值对应的PS/PE/EV/EBITDA倍数是多少？与同阶段、同赛道公司相比处于什么分位？

## 可比公司参照
列出3-5家最具可比性的公司（国内外），对比其估值倍数和关键指标。

## 增长假设检验
当前估值隐含的增长预期是什么？这个增长预期在历史上有多少公司实现过？

## 投资回报测算
假设3年/5年退出，需要公司达到什么规模才能实现2x/3x/5x回报？这个规模现实吗？

## 下行保护评估
如果公司增长低于预期50%，当前估值的安全边际如何？

## 估值谈判建议
合理的估值区间建议？有哪些条款可以弥补估值过高的风险？',
ARRAY['investment_committee']::VARCHAR[],
14),

('可比公司分析',
'系统梳理同赛道可比公司，建立估值参照系',
'valuation',
'请对以下项目进行可比公司分析，建立合理的估值参照系。

项目信息：
{project_info}

财务数据：
{financial_data}

## 可比公司筛选标准
基于该项目的业务模式、市场、阶段，定义可比公司的筛选标准。

## 国内可比公司
列出3-5家国内最具可比性的公司，包括：融资历史、当前估值/市值、核心指标、与标的的关键差异。

## 海外可比公司
列出2-3家海外市场的参照公司，说明借鉴意义与局限性。

## 估值倍数区间
基于可比公司，推导合理的估值倍数区间（PS/ARR倍数/用户价值等）。

## 溢价/折价因素
该公司相对可比公司，应该享有溢价还是折价？原因是什么？

## 估值区间结论
基于可比分析，给出合理估值区间的建议。',
ARRAY['investment_committee']::VARCHAR[],
15),

('退出路径分析',
'评估可行的退出路径与时间窗口',
'valuation',
'请对以下项目的退出路径进行系统分析，评估投资回报的可实现性。

项目信息：
{project_info}

财务数据：
{financial_data}

## 潜在退出路径

### IPO 路径
上市可行性评估？目标市场（A股/港股/美股）？预计上市时间窗口？当前与上市标准的差距？

### 并购退出
潜在战略收购方有哪些？收购动机？历史上同赛道的并购案例和估值倍数？

### 股权转让/老股退出
二级市场流动性如何？是否有潜在的接盘方（PE/大厂）？

## 退出障碍评估
哪些因素可能阻碍退出？（股权结构/监管/市场窗口/公司业绩）

## 时间窗口判断
最可能的退出时间是多久之后？市场窗口是否与公司发展节奏匹配？

## 回报测算
基于最可能的退出路径和时间，测算IRR区间（乐观/基准/悲观三个情景）。',
ARRAY['investment_committee']::VARCHAR[],
16),

('投资条款风险点',
'识别 Term Sheet 中的关键风险条款',
'valuation',
'请对投资条款中的关键风险点进行分析。注意：本分析仅供参考，不构成法律意见。

项目信息：
{project_info}

请分析以下投资条款的常见风险：

## 优先清算权
清算倍数是否合理？参与分配条款？对普通股的稀释影响？

## 反稀释条款
完全棘轮还是加权平均？触发条件？对后续融资的影响？

## 控制权条款
董事会席位安排？一票否决权的范围？是否过于强势？

## 创始人锁定
Vesting安排是否合理？反向Vesting条款？竞业限制范围？

## 优先认购权
比例是多少？是否影响后续融资灵活性？

## 拖售权/随售权
触发条件？保护机制是否足够？

## 本次条款的综合评价
对投资方和创始方的平衡性如何？有哪些条款建议修改？',
ARRAY['investment_committee']::VARCHAR[],
17),

-- 投后管理类
('投后跟踪问卷',
'生成定期投后跟踪的结构化问卷',
'post_investment',
'请基于以下项目信息，生成一份季度投后跟踪问卷，帮助系统性了解被投企业的经营状况。

项目信息：
{project_info}

## 财务健康指标（必填）
设计5-8个最关键的财务数据收集项（收入/现金/用户数等，根据业务模式定制）。

## 里程碑完成情况
列出本季度应完成的3-5个关键里程碑，以及完成情况的评分标准。

## 团队与组织
核心团队稳定性？本季度重要人才进出？

## 市场与竞争
市场有何新变化？竞争格局是否有重大调整？

## 主要风险与挑战
创始人自我评估的最大风险？需要投资人哪些支持？

## 下季度计划
下季度核心目标（3个以内）？所需资源？

## 投资人行动项
基于本次跟踪，投资人需要做什么（资源对接/风险预警/下次沟通时间）？',
ARRAY['post_investment']::VARCHAR[],
18),

('财务健康检查',
'对被投企业进行定期财务健康评估',
'post_investment',
'请对以下被投项目进行财务健康检查，识别需要关注的风险信号。

项目信息：
{project_info}

财务数据：
{financial_data}

## 现金跑道评估
当前现金余额？月均烧钱速度？预计还能运营几个月？

## 收入健康度
收入增长趋势？环比是否出现下滑？客户流失率？

## 成本控制
人员规模与收入增长是否匹配？有无不合理的成本膨胀？

## 应收账款健康度
账期是否在延长？是否有坏账风险？

## 融资必要性
按当前发展节奏，何时需要开始新一轮融资？是否应该提前启动？

## 风险预警信号
列出所有需要立即关注的财务异常信号，以及建议的应对措施。',
ARRAY['post_investment']::VARCHAR[],
19),

('归档复盘报告',
'项目退出或终止时生成系统性复盘',
'post_investment',
'请基于以下项目的完整信息，生成一份深度复盘报告，帮助投资人从这个项目中提取最大认知价值。

项目信息：
{project_info}

投资判断记录：
{judgments}

## 投资决策回顾
当初投资的核心逻辑是什么？现在看这个逻辑是否成立？

## 判断准确性评估
逐一回顾当初的关键判断：哪些判断是对的？哪些是错的？

## 认知盲点识别
在这个项目上，你的认知盲点在哪里？为什么会有这个盲点？

## 过程中的决策质量
投后管理过程中，有哪些决策是对的？有哪些本可以做得更好？

## 可迁移的经验
从这个项目中提取3-5条可以应用到未来投资决策的具体经验。

## 对同类项目的判断影响
这个项目的结果，应该如何影响你对同类赛道/阶段/模式的判断框架？',
ARRAY['post_investment']::VARCHAR[],
20)

) AS v(name, description, category, prompt_template, applicable_stages, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM skill_catalog);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/008_cognition_outcome.sql
-- ============================================================
-- 迁移 008：项目投资结果（outcome）字段
-- ============================================================
-- 用于认知进化分析：记录项目最终结果，回溯判断准确性。
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)
  CHECK (outcome IN ('invested', 'passed', 'exited_profit', 'exited_loss', 'pending'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS outcome_note TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMP WITH TIME ZONE;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/009_post_investment.sql
-- ============================================================
-- 迁移 009：投后管理 — 会议记录调整 + 投后跟踪记录表
-- ============================================================
-- 注意：meeting_notes 表已由 schema.sql 创建，且 meeting_type 的旧
--   CHECK 取值为 founder/expert/lp/post_invest/internal/other，
--   participants 为 jsonb。本迁移将 meeting_type 调整为投后管理用途
--   （regular/board/emergency/annual），并新增 ai_summary、
--   next_meeting_date。participants 保持 jsonb（存字符串数组）。
-- 幂等：可重复执行。
-- ============================================================

-- meeting_notes：调整 meeting_type 取值范围
ALTER TABLE meeting_notes
  DROP CONSTRAINT IF EXISTS meeting_notes_meeting_type_check;
ALTER TABLE meeting_notes
  ALTER COLUMN meeting_type SET DEFAULT 'regular';
ALTER TABLE meeting_notes
  ADD CONSTRAINT meeting_notes_meeting_type_check
  CHECK (meeting_type IN ('regular', 'board', 'emergency', 'annual'));

-- meeting_notes：新增字段
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS next_meeting_date DATE;

-- 投后跟踪记录表
CREATE TABLE IF NOT EXISTS post_investment_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  update_type VARCHAR(30) DEFAULT 'regular'
    CHECK (update_type IN ('regular', 'milestone', 'risk', 'financing', 'personnel', 'exit')),
  content TEXT NOT NULL,
  period VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_updates_project_id
  ON post_investment_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_post_updates_user_id
  ON post_investment_updates(user_id);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/010_auth_improvements.sql
-- ============================================================
-- 迁移 010：登录系统生产级加固
--   - login_attempts：登录失败限流
--   - password_reset_tokens：密码重置令牌
--   - phone_verify_codes：手机验证码
--   - users 新增 phone 字段
--   - 为支持手机号注册：放开 email 的 NOT NULL，auth_provider 允许 'phone'
-- 幂等：可重复执行。
-- ============================================================

-- 登录限流表
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL,
  attempted_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier
  ON login_attempts(identifier, attempted_at);

-- 密码重置令牌表
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 手机验证码表
CREATE TABLE IF NOT EXISTS phone_verify_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  purpose VARCHAR(20) NOT NULL, -- login / register
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phone_verify_codes_phone
  ON phone_verify_codes(phone, created_at);

-- users 表新增手机号字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE;

-- 手机号注册用户无邮箱：放开 email 的 NOT NULL 约束
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- auth_provider 放开 'phone'（原 CHECK 仅允许 credentials / github）
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('credentials', 'github', 'phone'));

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/011_user_profile.sql
-- ============================================================
-- 迁移 011：用户投资人画像
--   user_profiles：每个用户的投资偏好与判断标准，
--   用于在调用大模型时前置注入 system prompt。
-- 幂等：可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  focus_stages TEXT[] DEFAULT '{}',
  focus_sectors TEXT[] DEFAULT '{}',
  investment_style VARCHAR(20) DEFAULT NULL,
  check_size VARCHAR(50) DEFAULT NULL,
  typical_hold_period VARCHAR(50) DEFAULT NULL,

  self_intro TEXT DEFAULT NULL,
  decision_criteria TEXT DEFAULT NULL,
  avoid_patterns TEXT DEFAULT NULL,
  output_preference TEXT DEFAULT NULL,
  extra_context TEXT DEFAULT NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/012_conversation_digest.sql
-- ============================================================
-- 迁移 012：对话沉淀 —— 知识库支持对话提炼条目
--   - knowledge_base_entries 新增 structured_data / source_report_id / review_status
--   - 放宽 entry_type 的 CHECK 约束，纳入 manual / conversation_digest / document_chunk
-- 幂等：可重复执行。
-- ============================================================

-- 1. 放宽 entry_type 的取值
ALTER TABLE knowledge_base_entries
  DROP CONSTRAINT IF EXISTS knowledge_base_entries_entry_type_check;

ALTER TABLE knowledge_base_entries
  ADD CONSTRAINT knowledge_base_entries_entry_type_check
  CHECK (entry_type IN (
    'industry', 'project', 'thesis', 'prediction', 'chunk',
    'manual', 'conversation_digest', 'document_chunk'
  ));

-- 2. 新增字段
ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS structured_data JSONB DEFAULT NULL;

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS source_report_id UUID
    REFERENCES reports(id) ON DELETE SET NULL DEFAULT NULL;

ALTER TABLE knowledge_base_entries
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(10) DEFAULT 'approved';

-- 3. 历史数据补全
UPDATE knowledge_base_entries
   SET review_status = 'approved'
 WHERE review_status IS NULL;

-- 4. 便于按报告反查
CREATE INDEX IF NOT EXISTS idx_kb_source_report
  ON knowledge_base_entries(source_report_id);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/013_conversations.sql
-- ============================================================
-- 迁移 013：独立对话（standalone chat）
--   conversations：用户与 AI 的多轮对话，可关联项目，可触发认知沉淀。
-- 幂等：可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) DEFAULT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL DEFAULT NULL,
  -- 消息格式：[{role: 'user'|'assistant', content: string, ts: ISO string}, ...]
  messages JSONB NOT NULL DEFAULT '[]',
  summary TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_project
  ON conversations(project_id);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/014_onboarding.sql
-- ============================================================
-- 迁移 014：新用户引导完成标记
--   users.onboarding_completed：用户首次完成引导后置 true，避免重复弹窗
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/015_user_skill_metadata.sql
-- ============================================================
-- 迁移 015：自建 SKILL 元数据
--   user_custom_skills.metadata：记录导入 / 自动生成等来源信息
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE user_custom_skills
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/016_user_ai_base_url.sql
-- ============================================================
-- 迁移 016：用户自定义 Base URL（OpenAI 兼容 endpoint 覆写）
--   - users.ai_base_url：可选；为空时使用各服务商默认 endpoint
--   - 用途：天翼 Token / 自部署网关 等场景需要覆盖默认 URL
-- 幂等：可重复执行。
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_base_url TEXT DEFAULT NULL;

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/017_free_quota.sql
-- ============================================================
-- 迁移 017：系统免费额度（平台代付 DeepSeek）
--   - free_quota_usage：按手机号粒度跟踪 token 使用（防止多账号薅羊毛）
--   - free_quota_logs：单次调用明细，便于审计与排查
-- 幂等：可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS free_quota_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL UNIQUE,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  tokens_limit BIGINT NOT NULL DEFAULT 10000000,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS free_quota_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  feature VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_free_quota_usage_user
  ON free_quota_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_free_quota_logs_user
  ON free_quota_logs(user_id);

-- /sessions/beautiful-happy-ptolemy/mnt/investment-workbench/db/migrations/018_free_quota_by_userid.sql
-- ============================================================
-- 迁移 018：免费额度唯一键从 phone 改为 user_id
--   - 支持邮箱注册用户（无手机号）也能使用免费额度
--   - phone 列保留（历史数据兼容），但放宽为可空
--   - 默认额度调整为 500 万 tokens
-- 幂等：可重复执行。
-- 说明：执行前请确认 free_quota_usage 中不存在重复 user_id，
--       否则 ADD UNIQUE(user_id) 会失败（正常情况下每个 user_id 唯一）。
-- ============================================================

-- 1. 删除原 phone 唯一约束
ALTER TABLE free_quota_usage DROP CONSTRAINT IF EXISTS free_quota_usage_phone_key;

-- 2. phone 放宽为可空（邮箱用户没有手机号）
ALTER TABLE free_quota_usage ALTER COLUMN phone DROP NOT NULL;

-- 3. 新增 user_id 唯一约束（幂等：已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_quota_usage_user_id_key'
  ) THEN
    ALTER TABLE free_quota_usage
      ADD CONSTRAINT free_quota_usage_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 4. 默认额度 1000 万 → 500 万（仅影响后续新建行；存量行不变）
ALTER TABLE free_quota_usage ALTER COLUMN tokens_limit SET DEFAULT 5000000;

