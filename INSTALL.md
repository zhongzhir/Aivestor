# Aivestor 本地化部署安装指南

**版本**：V3.0 · 2026-06-01  
**适用系统**：Windows 10/11、macOS 12+、Ubuntu 22.04+

---

## 概述

Aivestor 支持完整的本地化部署。部署完成后：

- 所有数据（项目、知识库、判断记录、上传文件）存储在你自己的机器上
- AI 分析功能通过你自己的 API Key 调用外部模型（DeepSeek / Claude / OpenAI 等）
- 平台本身不收集任何数据，不依赖任何强制性云服务

---

## 前置条件

### 必须安装

**Docker Desktop**（免费）

| 系统 | 下载地址 |
|------|---------|
| Windows | https://www.docker.com/products/docker-desktop/ |
| macOS | https://www.docker.com/products/docker-desktop/ |
| Linux | https://docs.docker.com/engine/install/ |

安装并启动 Docker Desktop，确认状态栏或系统托盘中 Docker 图标显示为运行中。

> **Linux 用户**：额外执行 `sudo apt install docker-compose-plugin`

### 硬件要求

| 配置 | 最低 | 推荐 |
|------|------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 10 GB 可用空间 | 20 GB+ |

---

## 第一步：获取代码

**方式 A：下载 ZIP（无需 Git）**

1. 打开 https://github.com/zhongzhir/Aivestor
2. 点击绿色「Code」按钮 → 「Download ZIP」
3. 解压到任意文件夹，例如 `C:\Aivestor` 或 `~/Aivestor`

**方式 B：Git 克隆**

```bash
git clone https://github.com/zhongzhir/Aivestor.git
cd Aivestor
```

---

## 第二步：生成配置文件

有两种方式，选其一即可。

---

### 方式 A：一键配置脚本（推荐）

脚本在本地运行，自动生成所有密钥，只需回答 2 个问题。  
**所有信息仅写入本机的 `.env.docker` 文件，不会上传到任何服务器。**

**Windows（双击运行）：**

在 Aivestor 文件夹中，双击 `setup.bat`，按提示操作。

> 如果提示"Windows 已保护你的电脑"，点击「更多信息」→「仍要运行」。

**macOS / Linux（终端运行）：**

```bash
cd Aivestor          # 进入代码文件夹
chmod +x setup.sh    # 添加执行权限（只需一次）
./setup.sh           # 运行脚本
```

脚本会依次询问：

1. **访问地址**：本机访问直接回车（默认 localhost）；局域网或公网访问选对应选项
2. **百炼 API Key**（可选）：用于知识库智能搜索，跳过则使用关键词搜索，不影响其他功能

完成后自动生成 `.env.docker` 文件，**跳至第三步**。

---

### 方式 B：手动配置（适合有技术背景的用户）

复制模板文件：

```bash
cp .env.docker.example .env.docker
```

用文本编辑器打开 `.env.docker`，填写以下**必填项**：

#### 1. 访问地址

```
NEXTAUTH_URL=http://localhost
```

本机访问填 `http://localhost`，局域网填 `http://你的局域网IP`，服务器填域名或公网 IP。

#### 2. 数据库密码

```
DB_PASSWORD=自定义一个强密码
```

建议 12 位以上，包含字母和数字，例如 `Aivestor2026!`。

#### 3. JWT 签名密钥

```
NEXTAUTH_SECRET=（运行下方命令生成）
```

生成命令：

```bash
# macOS / Linux
openssl rand -base64 32

# Windows PowerShell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

将输出结果填入 `NEXTAUTH_SECRET=` 后面。

#### 4. 数据加密密钥

```
ENCRYPTION_KEY=（运行下方命令生成）
```

生成命令：

```bash
# macOS / Linux / Windows（需安装 Node.js）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

将输出的 64 位十六进制字符串填入 `ENCRYPTION_KEY=` 后面。

> ⚠️ **重要**：`NEXTAUTH_SECRET` 和 `ENCRYPTION_KEY` 一旦设定请勿更改。更换 `ENCRYPTION_KEY` 会导致已保存的 API Key 无法解密。

#### 5. 百炼 API Key（可选）

```
BAILIAN_API_KEY=sk-xxxx
```

用于知识库的语义搜索（向量检索）。不填则使用关键词搜索，其他功能完全不受影响。  
申请地址：https://bailian.console.aliyun.com/（注册后有免费额度）

---

## 第三步：启动服务

在 Aivestor 文件夹中打开终端，执行：

```bash
docker compose --env-file .env.docker up -d --build
```

**首次启动说明：**
- 需要下载基础镜像和构建应用，约需 **3～10 分钟**（取决于网速）
- 出现以下输出表示启动成功：

```
✔ Container aivestor-db     Started
✔ Container aivestor-app    Started
✔ Container aivestor-nginx  Started
```

**查看启动状态：**

```bash
docker compose ps
```

所有服务状态应为 `running`。

**查看应用日志（如有异常）：**

```bash
docker compose logs -f app
```

---

## 第四步：访问与注册

打开浏览器，访问：

- 本机安装：**http://localhost**
- 局域网/服务器：**http://你配置的地址**

点击「注册」创建账号，即可开始使用。

> 首次注册的账号即为管理员账号，建议使用邮箱注册。

---

## 功能说明

| 功能 | 无任何 API Key | 配置用户自己的 API Key | 配置百炼 Key |
|------|--------------|---------------------|------------|
| 注册 / 登录 | ✅ | ✅ | ✅ |
| AI 对话、项目分析、报告生成 | ❌ 需要 API Key | ✅ | ✅ |
| 知识库关键词搜索 | ✅ | ✅ | ✅ |
| 知识库语义搜索（更智能）| ❌ | ❌ | ✅ |
| BP 文件上传（本地存储）| ✅ | ✅ | ✅ |

**用户 API Key 配置**：登录后进入「个人设置」→「AI 配置」，填写 DeepSeek / OpenAI / Claude 等任意服务的 API Key，即可使用 AI 功能。

---

## 常用管理命令

```bash
# 停止服务
docker compose down

# 重启服务
docker compose --env-file .env.docker up -d

# 更新到最新版本
git pull
docker compose --env-file .env.docker up -d --build

# 查看日志
docker compose logs -f app       # 应用日志
docker compose logs -f db        # 数据库日志

# 备份数据库
docker exec aivestor-db pg_dump -U aivestor aivestor_db > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker exec -i aivestor-db psql -U aivestor aivestor_db < backup_20260101.sql
```

---

## 数据存储位置

| 数据类型 | 存储位置 |
|---------|---------|
| 数据库（项目、知识库、报告等）| Docker volume `aivestor_pgdata` |
| 上传的文件（BP 文档等）| Docker volume `aivestor_uploads` |
| 配置文件 | 本机 `.env.docker` 文件 |

删除容器不会丢失数据，数据存在 Docker volume 中。  
如需彻底清除，运行 `docker compose down -v`（**此操作不可恢复**）。

---

## 常见问题

**Q：启动后访问 http://localhost 显示空白或报错？**  
A：等待约 30 秒后刷新，应用启动需要一定时间。如持续报错，运行 `docker compose logs app` 查看详细错误。

**Q：端口 80 被占用？**  
A：编辑 `docker-compose.yml`，将 nginx 的 `"80:80"` 改为 `"8080:80"`，然后访问 `http://localhost:8080`。

**Q：如何在局域网其他设备上访问？**  
A：重新运行 `setup.sh`（或 `setup.bat`），选择选项 2，输入本机局域网 IP，重新生成配置后重启服务。

**Q：忘记密码怎么办（邮件未配置）？**  
A：直接在数据库重置：
```bash
docker exec -it aivestor-db psql -U aivestor aivestor_db
# 在 psql 中执行（将邮箱和新密码哈希替换）：
# UPDATE users SET password_hash = '$2a$...' WHERE email = 'your@email.com';
```
或联系部署管理员操作。

**Q：如何配置 HTTPS？**  
A：备案/域名申请完成后，将 SSL 证书文件（`.pem` 和 `.key`）放入 `docker/ssl/` 目录，取消 `docker/nginx.conf` 中 HTTPS server 块的注释，更新 `NEXTAUTH_URL` 为 `https://` 地址，重启服务。

---

## 技术支持

- 项目仓库：https://github.com/zhongzhir/Aivestor
- 联系邮箱：Aivestor@qq.com
