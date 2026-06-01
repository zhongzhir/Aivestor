# Deployment

用户部署请参考 **[INSTALL.md](./INSTALL.md)**。

本仓库包含完整源代码，部署相关文件位于：

- `Dockerfile`、`docker-compose.yml` — 容器编排
- `docker/` — 数据库初始化脚本、Nginx 配置、SSL 目录占位
- `.env.docker.example` — 环境变量模板
- `setup.sh` / `setup.bat` — 一键配置脚本
- `INSTALL.md` — 完整安装指南
- `DEPLOY.md` — 高级部署细节（HTTPS、备份恢复、迁移等）
