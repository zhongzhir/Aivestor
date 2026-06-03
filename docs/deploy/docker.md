# Docker 本地部署

如果你对数据安全有严格要求，希望数据完全在本机，可以使用 Docker Compose 一键本地化部署。

## 前置要求

- Docker Desktop（Windows / macOS）或 Docker Engine（Linux）
- 约 2GB 磁盘空间

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

脚本会引导你填写必要的配置（邮箱服务、AI API Key 等），自动生成 `.env.docker` 文件。

### 3. 启动服务

```bash
docker compose up -d
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

所有数据（数据库、上传文件）通过 Docker Volume 持久化存储在本机，重启不丢失。

## 已验证版本

当前 Docker Hub 镜像：`zhongzhir/aivestor:3.1.1`

> 如遇部署问题，欢迎提 [GitHub Issue](https://github.com/zhongzhir/aivestor/issues) 或发邮件至 Aivestor@qq.com
