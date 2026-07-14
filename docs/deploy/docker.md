# Docker 私有化部署

如果你对数据边界、内网访问或机构合规有明确要求，可以用 Docker Compose 一键部署自己的 Aivestor 实例。数据库、上传文件和项目记录保存在你控制的本机或服务器上。

## 前置要求

- Docker Desktop（Windows / macOS）或 Docker Engine（Linux）
- 最低 2 核 CPU / 4GB 内存 / 10GB 磁盘；多用户建议 4 核 / 8GB / 20GB+

## 快速部署

### 1. 克隆仓库

```bash
git clone https://github.com/zhongzhir/aivestor.git
cd aivestor
```

### 2. 运行配置脚本

**Windows：**
```bash
setup.bat
```

**macOS / Linux：**
```bash
chmod +x setup.sh && ./setup.sh
```

脚本会引导你填写访问地址和可选的百炼 API Key，并自动生成数据库密码、登录密钥和 API Key 加密密钥，写入 `.env.docker` 文件。

### 3. 启动服务

```bash
docker compose --env-file .env.docker up -d --build
```

### 4. 访问

浏览器打开 `http://localhost`（**必须通过 80 端口，不能直接访问 :3000**）

## 环境变量说明

| 变量 | 是否必填 | 说明 |
|------|---------|------|
| NEXTAUTH_SECRET | ✅ 必填 | 会话加密密钥（脚本自动生成） |
| ENCRYPTION_KEY | ✅ 必填 | API Key 加密密钥（脚本自动生成） |
| NEXTAUTH_URL | ✅ 必填 | 访问地址，默认 `http://localhost` |
| BAILIAN_API_KEY | 可选 | 阿里云百炼，用于向量检索；无则降级为关键词搜索 |
| 邮件/短信配置 | 可选 | 阿里云 DirectMail / SMS；无则关闭邮件验证 |

详见仓库根目录 `DEPLOY.md`。

## 数据持久化

所有数据（数据库、上传文件）通过 Docker Volume 持久化存储在本机或服务器上，重启和重建容器不会丢失。正式使用前建议配置定期数据库备份。

## 已验证版本

当前推荐方式：从 GitHub 仓库拉取源码后使用 Docker Compose 构建运行。

> 如遇部署问题，欢迎提 [GitHub Issue](https://github.com/zhongzhir/aivestor/issues) 或发邮件至 Aivestor@qq.com
