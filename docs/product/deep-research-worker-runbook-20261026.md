# 深度投研后台 Worker 部署说明（2026-10-26）

## 目标

深度投研完整模式使用数据库持久化队列和独立 Node.js worker。网页只负责入队和读取状态；关闭页面不会中断外部取证、报告生成、质量门禁或尽调任务创建。

## 上线顺序

1. 备份数据库并依次应用 `048_deep_research_reports.sql`、`049_deep_research_evidence.sql`、`050_deep_research_jobs.sql`。
2. 先运行应用构建和专项回归，再发布 Web 进程。
3. 使用与 Web 相同的只读配置/AI/检索环境变量启动独立 worker：`npm run deep-research:worker`。
4. Worker 应作为独立 PM2 或 systemd 进程，建议单实例起步，限制内存并自动重启；不要嵌入 Web 请求生命周期。
5. 对旧材料分批执行 `npm run db:backfill-source-maps -- --limit=50`，每批核对失败清单后再继续。

## 状态与恢复

- 一个项目同时只允许一个 `queued/running` 任务。
- Worker 使用 `FOR UPDATE SKIP LOCKED` 抢占任务，避免并发重复执行。
- 运行中任务每个阶段刷新 `locked_at`；锁超过20分钟可由后续 worker 重新领取。
- 失败任务保留阶段、错误码和错误信息，最多重试3次。
- 报告只在正文和门禁生成完成后落库，避免失败留下空报告。
- 尽调任务按 `job_id + evidence_item_id` 幂等写入。

## 首次验收

使用一份合成项目和一份授权真实项目分别验证：任务入队、关闭页面、worker完成、外部URL可打开、关键事实降级规则、报告E编号引用、质量门禁、P0/P1/P2任务、失败重试、主站原功能回归和资源占用。未完成真实联网样本前，不将“代码通过”扩大为生产取证质量验收。
