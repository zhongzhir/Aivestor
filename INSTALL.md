# Aivestor 私有化部署指南

**版本**：V3.1 · 2026-06-01  
**文档读者**：负责部署的 IT 人员或具备 Linux/Docker 基础的技术人员  
**适用场景**：机构内网私有化部署、个人服务器自托管

> 如果你是普通用户，无需阅读本文档。直接访问 [https://vestia-two.vercel.app](https://vestia-two.vercel.app) 注册使用云端版本即可。

---

## 部署架构概览

```
用户浏览器
    │  HTTP/HTTPS
    ▼
Nginx（反向代理 + 静态资源）
    │
    ▼
Next.js 应用（端口 3000，内部）
    │
    ▼
PostgreSQL + pgvector（端口 5432，内部）
```

三个服务均运行在 Docker 容器内，通过内部网络互联，对外仅暴露 80（或 443）端口。

---

## 前置条件

### 运行环境

| 环境 | 要求 |
|------|------|
| 操作系统 | Linux（推荐 Ubuntu 22.04）、macOS 12+、Windows 10/11（需 WSL2）|
| Docker Engine | 24.0+ |
| Docker Compose | V2（`docker compose` 命令，注意不是 `docker-compose`）|
| 可用端口 | 80（HTTP），443（HTTPS，可选）|

**安装 Docker（Ubuntu）：**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 免 sudo 运行 docker
sudo apt install docker-compose-plugin
newgrp docker                   # 使用户组变更生效（或重新登录）
```

其他系统请参考官方文档：https://docs.docker.com/engine/install/

### 硬件要求

| 配置 | 最低 | 推荐（多用户）|
|------|------|-------------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 50 GB+ |

---

## 第一步：获取代码

**方式 A：Git 克隆**

```bash
git clone https://github.com/zhongzhir/aivestor.git
cd aivestor
```

**方式 B：下载 ZIP（无需 Git）**

1. 打开 https://github.com/zhongzhir/aivestor
2. 点击绿色「Code」按钮 →「Download ZIP」
3. 解压到任意文件夹后进入该目录

**Windows 用户：** 在 WSL2 终端内执行上述命令，或在 Windows 资源管理器中下载 ZIP 后解压，路径中避免中文和空格。

---

## 第二步：生成配置文件

复制配置模板：

```bash
cp .env.docker.example .env.docker
```

用编辑器打开 `.env.docker`，按以下说明填写：

### 必填项

#### NEXTAUTH_URL — 访问地址

```
# 仅本机访问
NEXTAUTH_URL=http://localhost

# 局域网部署（替换为服务器实际 IP）
NEXTAUTH_URL=http://192.168.1.100

# 公网/域名部署
NEXTAUTH_URL=https://aivestor.yourdomain.com
```

#### DB_PASSWORD — 数据库密码

```
DB_PASSWORD=<your-strong-password-min-16-chars>
```

建议 16 位以上，包含大小写字母、数字、特殊字符。

#### NEXTAUTH_SECRET — JWT 签名密钥

```bash
# 生成命令（任选其一）
openssl rand -base64 32
# 或
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

将输出结果填入：

```
NEXTAUTH_SECRET=<生成的随机字符串>
```

#### ENCRYPTION_KEY — API Key 加密密钥

```bash
# 生成命令
openssl rand -hex 32
# 或
python3 -c "import secrets; print(secrets.token_hex(32))"
```

将输出的 64 位十六进制字符串填入：

```
ENCRYPTION_KEY=<64位十六进制字符串>
```

> ⚠️ **NEXTAUTH_SECRET 和 ENCRYPTION_KEY 一旦写入并启动服务，禁止修改。**  
> 修改 ENCRYPTION_KEY 将导致所有用户已保存的 API Key 无法解密。  
> 务必将 `.env.docker` 文件备份到安全位置。

### 可选项

#### BAILIAN_API_KEY — 知识库语义搜索

```
BAILIAN_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```

用于知识库的向量语义搜索（更智能的内容检索）。不填则退化为关键词搜索，其他功能不受影响。  
申请地址：https://bailian.console.aliyun.com/（注册即有免费额度）

---

## 第三步：启动服务

```bash
docker compose --env-file .env.docker up -d --build
```

**首次启动**需要拉取基础镜像并构建应用，耗时约 5～15 分钟（取决于网速和服务器性能）。

**确认服务状态：**

```bash
docker compose ps
```

期望输出（所有服务 Status 为 running）：

```
NAME              STATUS    PORTS
aivestor-db       running   5432/tcp
aivestor-app      running   3000/tcp
aivestor-nginx    running   0.0.0.0:80->80/tcp
```

**如有异常，查看应用日志：**

```bash
docker compose logs --tail=50 app
```

---

## 第四步：初始化与访问

浏览器访问配置的地址（例如 `http://localhost` 或 `http://服务器IP`）。

**首次访问注意：**
- 页面首次加载约需 10～30 秒（Next.js 冷启动）
- 第一个注册的账号自动成为管理员
- 建议管理员账号使用邮箱注册，并记录密码

---

## 功能与 API Key 说明

| 功能模块 | 无 API Key | 用户配置自己的 API Key | 配置百炼 Key |
|---------|-----------|---------------------|------------|
| 注册 / 登录 / 账号管理 | ✅ | ✅ | ✅ |
| BP 上传、文件解析 | ✅ | ✅ | ✅ |
| 知识库（关键词检索）| ✅ | ✅ | ✅ |
| AI 对话、项目分析、报告生成 | ❌ | ✅ | ✅ |
| 知识库语义搜索 | ❌ | ❌ | ✅ |

**用户 API Key 配置路径：** 登录后 → 个人设置 → AI 配置  
支持：DeepSeek / OpenAI / Claude (Anthropic) / 通义千问 / 智谱 AI / Moonshot

---

## HTTPS 配置

域名和 SSL 证书准备就绪后执行：

1. 将证书文件放入 `docker/ssl/` 目录：
   ```
   docker/ssl/cert.pem
   docker/ssl/key.pem
   ```

2. 编辑 `docker/nginx.conf`，取消 HTTPS server 块的注释。

3. 更新 `.env.docker` 中的访问地址：
   ```
   NEXTAUTH_URL=https://aivestor.yourdomain.com
   ```

4. 重启服务：
   ```bash
   docker compose --env-file .env.docker up -d --build
   ```

---

## 日常运维命令

```bash
# 停止服务（数据不丢失）
docker compose down

# 重启服务
docker compose --env-file .env.docker up -d

# 更新到新版本
git pull                                              # 拉取最新代码
docker compose --env-file .env.docker up -d --build  # 重新构建并启动

# 查看实时日志
docker compose logs -f app        # 应用日志
docker compose logs -f db         # 数据库日志
docker compose logs -f nginx      # Nginx 日志

# 备份数据库（建议每日执行）
docker exec aivestor-db pg_dump -U aivestor aivestor_db \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复数据库
docker exec -i aivestor-db psql -U aivestor aivestor_db < backup_20260601_120000.sql
```

---

## 数据存储说明

| 数据类型 | 存储位置 | 备注 |
|---------|---------|------|
| 数据库（项目、知识库、报告等）| Docker volume `aivestor_pgdata` | 删除容器不丢失 |
| 上传文件（BP 文档等）| Docker volume `aivestor_uploads` | 删除容器不丢失 |
| 配置文件 | 本机 `.env.docker` | 请妥善备份 |

> ⚠️ 彻底清除所有数据：`docker compose down -v`（**不可恢复，执行前请备份**）

---

## 常见问题排查

**Q：端口 80 被占用（Address already in use）**  
编辑 `docker-compose.yml`，将 nginx 的 `"80:80"` 改为 `"8080:80"`，访问地址改为 `http://IP:8080`，同步修改 `NEXTAUTH_URL`。

**Q：Windows 上启动报错 `ports are not available: exposing port TCP 0.0.0.0:80`**  
Windows 对 80 端口有权限限制（常被 IIS、World Wide Web Publishing Service 或 Hyper-V 保留区段占用）。编辑 `docker-compose.yml` 将 nginx 的 `"80:80"` 改为 `"8080:80"`，同步修改 `.env.docker` 中 `NEXTAUTH_URL=http://localhost:8080`，重启服务后访问 `http://localhost:8080`。

**Q：docker compose 提示找不到 .env.docker 文件**  
确认当前终端工作目录为 Aivestor 项目根目录（`ls` 能看到 `docker-compose.yml`）。

**Q：镜像拉取超时（国内网络）**  
配置 Docker 镜像加速：
```bash
# 编辑或创建 /etc/docker/daemon.json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://registry.cn-hangzhou.aliyuncs.com"
  ]
}
sudo systemctl restart docker
```

**Q：Windows 上 setup.bat 运行后乱码或闪退**  
setup.bat 仅作为辅助工具，存在编码兼容问题。**Windows 用户推荐使用 WSL2**，在 WSL2 内按 Linux 步骤操作，体验与 Linux 完全一致。WSL2 安装：`wsl --install`（需 Windows 10 2004 及以上）。

**Q：忘记密码（邮件未配置时）**  
需要使用 bcrypt 生成新密码哈希后直接更新数据库。建议联系技术人员操作，或使用以下步骤：
```bash
# 生成密码哈希（需 Node.js）
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash('新密码',10).then(h=>console.log(h))"

# 连接数据库更新
docker exec -it aivestor-db psql -U aivestor aivestor_db
# 执行：UPDATE users SET password_hash = '上面生成的哈希' WHERE email = 'user@example.com';
```

**Q：应用启动后访问显示 502 Bad Gateway**  
V3.1 起 nginx 已通过 `depends_on: condition: service_healthy` 等待 app 健康检查通过再放流量，正常情况下不会再出现冷启 502。若仍遇到：
- 检查 `docker compose ps`，aivestor-app 应显示 `(healthy)`；若停留在 `(starting)`，多等 30 秒
- 否则查应用日志：`docker compose logs --tail=100 app`，常见原因是 DATABASE_URL/密钥未设或数据库未起来

**Q：必须经 Nginx 80 端口访问吗？能直连 3000 吗？**  
不能。直连 `http://...:3000` 时浏览器拿到的 cookie 域与 `NEXTAUTH_URL` 不一致，登录后立刻 401。务必通过 `NEXTAUTH_URL` 配置的地址（默认走 Nginx 的 80 端口）访问。

---

## 技术支持

- 项目仓库：https://github.com/zhongzhir/aivestor
- 联系邮箱：Aivestor@qq.com
- 部署问题请附上 `docker compose logs app` 的输出内容
