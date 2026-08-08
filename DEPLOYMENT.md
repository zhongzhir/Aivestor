# Deployment

用户部署请参考 **[INSTALL.md](./INSTALL.md)**。

本仓库包含完整源代码，部署相关文件位于：

- `Dockerfile`、`docker-compose.yml` — 容器编排
- `docker/` — 数据库初始化脚本、Nginx 配置、SSL 目录占位
- `.env.docker.example` — 环境变量模板
- `setup.sh` / `setup.bat` — 一键配置脚本
- `INSTALL.md` — 完整安装指南
- `DEPLOY.md` — 高级部署细节（HTTPS、备份恢复、迁移等）

## 生产仓库与白标部署边界

本仓库的主站与中鉴智投白标版已经是两个独立交付和维护边界：

- Aivestor 主站：从 `https://github.com/zhongzhir/aivestor` 发布到 `/var/www/Aivestor`，PM2 进程为 `aivestor`，域名为 `https://aivestor.cn`。
- 中鉴白标版：从 `https://github.com/zhongjian-zhitou/zhongjian-ai-investment-platform` 发布到 `/var/www/zhongjian-zhitou`，PM2 进程为 `zhongjian-zhitou`，域名为 `https://aivestor.com.cn`。

后续公共能力升级应先在 Aivestor 主仓库完成开发、验证和提交，再经双方明确评估，以 PR、cherry-pick 或 release 方式同步到中鉴独立仓库。`aivestor.com.cn` 的生产 ECS 不应直接从 Aivestor 主仓库拉取；中鉴专属改动默认只在中鉴独立仓库维护。

每次生产发布应记录 commit、production tag、migration、部署时间和验收结果。两个仓库不进行未经评估的自动双向 merge。
