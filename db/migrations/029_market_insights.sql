-- ============================================================
-- 迁移 029：市场洞察预生成内容（架构文档 v1.1 第 6.2 节）
-- ============================================================
-- 用途：定时任务（同步服务 insights.ts）调 AI 汇总 zjjr 数据 → 存表 →
--   /data-apps/market-insights 页面读表展示（零 AI 实时调用）。
--
-- 编号说明：架构原稿记为 025，但 025 跳号、028 已被 zjjr 管道占用，
--   本迁移取现有最大编号之后的 029（与生产保持单调）。
--
-- 写入者：同步服务专用账号 zjjr_sync（与 zjjr_* 表同账号；见迁移 028 末尾人工 GRANT）。
--   主应用账号对本表只读（GRANT SELECT；见文件末尾人工执行段）。
--
-- 幂等：可重复执行（IF NOT EXISTS / UNIQUE 约束支撑 upsert）。
-- 注意：本迁移【不自动执行】，需在生产库手动执行后，才能部署依赖本表的代码。
-- ============================================================

CREATE TABLE IF NOT EXISTS market_insights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 周期标识：如 '2026-W24'（周报）/ '2026-06'（月报）
  period       TEXT NOT NULL,
  period_kind  TEXT NOT NULL DEFAULT 'weekly'
                 CHECK (period_kind IN ('weekly', 'monthly')),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,            -- Markdown 正文
  data_as_of   DATE NOT NULL,           -- 数据截止日（页面免责声明引用）
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 生成器 upsert 对账键（同一周期重跑覆盖上期内容）
  UNIQUE (period, period_kind)
);

CREATE INDEX IF NOT EXISTS idx_market_insights_kind
  ON market_insights(period_kind, generated_at DESC);

-- ============================================================
-- 【人工执行 — 部署时由 DBA 手动落实】
-- ============================================================
-- 1) 同步服务写入账号（与 zjjr_* 同账号 zjjr_sync）：
--      GRANT SELECT, INSERT, UPDATE, DELETE ON market_insights TO zjjr_sync;
-- 2) 主应用账号只读（读表渲染页面）：
--      GRANT SELECT ON market_insights TO aivestor_app;
-- ============================================================
