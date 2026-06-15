// PM2 配置 — 中鉴数据同步服务（架构文档 v1.1 第 5.2 节）
//
// 运行模型：每日 02:30 由 PM2 按 cron 重拉进程，进程执行一次增量同步后自然退出
//   （cron_restart + autorestart:false）——比常驻进程内 setInterval 更可恢复。
//
// 专用 DB 账号（隔离红线 5.2）：本服务【必须】用专用账号 zjjr_sync 连接，
//   该账号对 zjjr_* 表全权限、对业务表零权限。账号创建与授权见迁移 028 文件末尾
//   「人工执行」段，需 DBA 在生产库手动落实。请在部署环境设置：
//     ZJJR_SYNC_DATABASE_URL=postgres://zjjr_sync:<pwd>@<host>:5432/<db>
//   （切勿复用主应用的 DATABASE_URL —— 那会打穿账号隔离。）
//
// 启动前置：迁移 028 已在生产库执行；ivfflat 索引由 full-sync 首次全量后建（见 write.ts）。

module.exports = {
  apps: [
    {
      name: "zjjr-sync",
      script: "dist/incremental-sync.js", // tsc 产物；开发期可改 ts-node src/incremental-sync.ts
      cwd: __dirname,
      autorestart: false, // 同步完即退出，不常驻
      cron_restart: "30 2 * * *", // 每日 02:30 增量轮询一次
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        // ZJJR_SYNC_DATABASE_URL 由部署环境注入（专用账号，勿写入仓库）
        // BAILIAN_API_KEY 由部署环境注入（向量化用，与主应用同一密钥约定）
        // ZJJR_CLIENT 默认 fixture；接入真实 API 后置为 http（见 src/client.ts）
        ZJJR_CLIENT: "fixture",
      },
    },
  ],
};
