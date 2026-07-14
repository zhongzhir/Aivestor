# Aivestor 私有化部署指南（Docker 版）

> Aivestor 支持两种使用方式：普通用户直接访问 <https://aivestor.cn> 注册使用；需要数据完全留在自控环境的个人、团队和机构，可以按本文档用 Docker 一键部署自己的 Aivestor 实例。
>
> 本文档面向**有 Docker 基础的 IT 人员、个人开发者或机构技术负责人**，覆盖从零到运行的完整路径与运维操作。

---

## 快速开始

三步起步，在本机或服务器上启动完整 Aivestor：

```bash
git clone https://github.com/zhongzhir/aivestor.git
cd aivestor
./setup.sh   # Windows 双击 setup.bat
docker compose --env-file .env.docker up -d --build
```

首次启动约 3 ~ 10 分钟（拉镜像 + 构建 app）。完成后浏览器打开 `http://localhost`（或脚本里指定的访问地址）注册即可。第一个注册账号建议作为管理员账号长期保存。

> ⚠️ **必须经 Nginx 80 端口访问，不要直连 `http://...:3000`。**
> Next.js 应用容器虽然把 3000 暴露在宿主上方便调试，但 NextAuth 会用 `NEXTAUTH_URL`（指向 80）来比对 cookie 的 host；直连 :3000 会导致 cookie 校验失败，登录后立刻 401。**始终通过 `NEXTAUTH_URL` 指向的地址访问**。

---

## 系统要求

| 项 | 要求 |
|----|------|
| 操作系统 | Linux（推荐 Ubuntu 22.04）/ macOS 12+ / Windows 10/11（推荐配 WSL2） |
| Docker Engine | 24.0+ |
| Docker Compose | V2 插件（命令是 `docker compose`，不是 `docker-compose`） |
| 可用端口 | 80（HTTP）、可选 443（HTTPS） |
| CPU / 内存 / 磁盘 | 最低 2 核 / 4 GB / 10 GB；推荐 4 核 / 8 GB / 20 GB+ |

> ℹ️ Linux 安装 Docker：`curl -fsSL https://get.docker.com | sh`，然后 `sudo apt install docker-compose-plugin`。其他系统参考 <https://docs.docker.com/engine/install/>。

## 为什么选择私有化部署

- **数据边界清晰**：数据库、上传材料、项目记录都保存在你控制的机器或内网服务器上。
- **适合机构合规**：可接入自己的域名、网络、备份、审计和访问控制流程。
- **不绑定云端账号**：团队可独立维护实例，模型 Key、OSS、邮件和短信服务均由部署方自行配置。
- **升级路径简单**：代码更新后重新构建容器即可，数据保存在 Docker Volume 中，不随容器重建丢失。

---

## 两种部署路径

### 路径 A：脚本引导（推荐）

`setup.sh` / `setup.bat` 在本地运行，自动生成所有密钥，只问 2 个问题。
**所有信息仅写入当前文件夹的 `.env.docker`，不会上传到任何服务器。**

**Linux / macOS：**

```bash
chmod +x setup.sh
./setup.sh
```

**Windows：** 双击 `setup.bat`，全英文交互。若提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。

脚本依次询问：

1. **访问地址**：本机直接回车（默认 `http://localhost`）；或选局域网 / 公网。
2. **百炼 API Key**（可选）：知识库语义检索用。留空则降级为关键词搜索，其他功能不受影响。

脚本会自动生成 `DB_PASSWORD`（20 字符）、`NEXTAUTH_SECRET`（44 字符 base64）、`ENCRYPTION_KEY`（64 字符十六进制），写入 `.env.docker`。

### 路径 B：手动配置

适合需要精细控制或已有现成密钥要复用的人。

```bash
cp .env.docker.example .env.docker
# 用编辑器打开 .env.docker，按下方「环境变量说明」逐项填写
```

> ⚠️ **`NEXTAUTH_SECRET` 与 `ENCRYPTION_KEY` 一旦设定并启动服务，禁止修改。**
> 修改 `ENCRYPTION_KEY` 会导致所有用户已保存的 API Key 无法解密。请把 `.env.docker` 备份到安全位置。

---

## 环境变量说明

### 必填项

| 变量名 | 说明 | 是否必填 | 不填时的降级行为 |
|--------|------|---------|----------------|
| `DB_PASSWORD` | PostgreSQL 数据库密码。建议 12 位以上、含字母+数字 | ✅ 必填 | 容器启动失败 |
| `NEXTAUTH_URL` | 应用访问地址（含协议）。本机 `http://localhost`；局域网 `http://192.168.x.x`；公网 `http://1.2.3.4` 或 `https://your.domain` | ✅ 必填 | NextAuth 无法工作，所有登录态校验失败 |
| `NEXTAUTH_SECRET` | JWT 签名密钥。生成命令：`openssl rand -base64 32`；Windows PowerShell：`$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)` | ✅ 必填 | NextAuth 启动报错 |
| `ENCRYPTION_KEY` | AES-256-GCM 加密主密钥，**必须为 64 位十六进制字符串**。生成方式见下方代码块 | ✅ 必填 | 保存用户 API Key 时报 500，无法加密 |

**`ENCRYPTION_KEY` 生成命令：**

```bash
# Linux / macOS
openssl rand -hex 32

# 任意系统（需 Node.js）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
# Windows PowerShell（无需额外依赖）
-join ((1..64) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
```

### AI 模型配置

> ℹ️ 用户登录后在「个人设置 → AI 配置」自行填写 API Key（DeepSeek / OpenAI / Claude / 通义 / 智谱 / Moonshot 等），平台 AES-256-GCM 加密存储。**用户 Key 不通过环境变量配置**。
>
> 本节的两个变量是**平台代付**机制，给新用户提供免费试用额度。

| 变量名 | 说明 | 是否必填 | 不填时的降级行为 |
|--------|------|---------|----------------|
| `SYSTEM_DEEPSEEK_API_KEY` | 平台代付的 DeepSeek API Key。配置后所有新用户获赠 `FREE_QUOTA_TOKENS` 个 token 免费额度 | 可选 | 用户必须自带 API Key 才能使用 AI 功能 |
| `FREE_QUOTA_TOKENS` | 每用户的免费 token 上限。默认 500 万（DeepSeek 单价下约够分析 10 ~ 20 个 BP） | 可选 | 默认 `5000000` |

### 知识库向量检索（可选）

| 变量名 | 说明 | 是否必填 | 不填时的降级行为 |
|--------|------|---------|----------------|
| `BAILIAN_API_KEY` | 阿里云百炼 Embedding API Key（text-embedding-v4，维度 1536）。申请：<https://bailian.console.aliyun.com/> | 可选 | 知识库自动降级为关键词搜索（PG 全文检索），其他功能不受影响 |

### 文件存储（可选）

| 变量名 | 说明 | 是否必填 | 不填时的降级行为 |
|--------|------|---------|----------------|
| `OSS_REGION` | 阿里云 OSS 区域，如 `oss-cn-beijing` | 仅 OSS 模式必填 | 自动降级为本地磁盘存储（Docker volume `uploads`） |
| `OSS_ACCESS_KEY_ID` | RAM 子账号 AccessKey ID（授权 `AliyunOSSFullAccess`） | 仅 OSS 模式必填 | 同上 |
| `OSS_ACCESS_KEY_SECRET` | RAM 子账号 AccessKey Secret | 仅 OSS 模式必填 | 同上 |
| `OSS_BUCKET` | OSS Bucket 名称（私有读写） | 仅 OSS 模式必填 | 同上 |

> ℹ️ **本地存储 vs OSS**：默认走本地磁盘（数据完全在本机，删除容器不丢、`docker compose down -v` 会清空）；多机共享或异地备份再考虑配 OSS。OSS 模式下需在 OSS 控制台 CORS 添加 `NEXTAUTH_URL` 来源。

### 邮件与短信（可选）

| 变量名 | 说明 | 是否必填 | 不填时的降级行为 |
|--------|------|---------|----------------|
| `ALIYUN_ACCESS_KEY_ID` | 阿里云邮件推送（DirectMail）的 AccessKey ID | 可选 | 「忘记密码」邮件发送不可用，需管理员直接在 DB 重置密码 |
| `ALIYUN_ACCESS_KEY_SECRET` | 对应 Secret | 可选 | 同上 |
| `ALIYUN_EMAIL_FROM` | 发信地址（已备案的发信域名下） | 可选 | 同上 |
| `ALIYUN_SMS_SIGN` | 阿里云短信签名（已审核通过） | 可选 | 手机号验证码登录不可用，可用邮箱登录 |
| `ALIYUN_SMS_TEMPLATE` | 短信模板 ID | 可选 | 同上 |

### 完整 .env.docker 示例

```env
# ── 必填 ────────────────────────────────────────────────────
DB_PASSWORD=ChangeMeToAStrongPassword
NEXTAUTH_URL=http://localhost
NEXTAUTH_SECRET=base64_44chars_from_openssl_rand_base64_32_xxx
ENCRYPTION_KEY=64_hex_chars_from_openssl_rand_hex_32_xxxxxxxxxxxxxxxxxxxxxxxxxx

# ── AI 能力 ─────────────────────────────────────────────────
BAILIAN_API_KEY=
SYSTEM_DEEPSEEK_API_KEY=
FREE_QUOTA_TOKENS=5000000

# ── 文件存储（留空则用本地磁盘）─────────────────────────────
OSS_REGION=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=

# ── 邮件服务 ────────────────────────────────────────────────
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_EMAIL_FROM=noreply@yourdomain.com

# ── 短信服务 ────────────────────────────────────────────────
ALIYUN_SMS_SIGN=
ALIYUN_SMS_TEMPLATE=
```

---

## 首次启动与验证

```bash
docker compose --env-file .env.docker up -d --build
```

> ⚠️ **`--env-file .env.docker` 不能省略。**
> docker compose 默认查找 `.env`，不会自动认 `.env.docker`。省略后所有变量都读不到，会以为是 bug。

启动顺序由 healthcheck 控制：

1. `aivestor-db` 启动并通过 `pg_isready` 检查
2. `aivestor-app` 启动并通过 `/api/health` 检查（最长 30s + 12 次重试 = 约 2.5 分钟兜底）
3. `aivestor-nginx` 见 app 状态 `healthy` 后才启动并接受流量

**确认状态：**

```bash
docker compose ps
```

期望输出（关注 `STATUS` 列里 `aivestor-app` 显示 `(healthy)`）：

```
NAME              IMAGE                      STATUS                    PORTS
aivestor-db       pgvector/pgvector:pg16     Up (healthy)              5432/tcp
aivestor-app      aivestor-app               Up (healthy)              0.0.0.0:3000->3000/tcp
aivestor-nginx    nginx:alpine               Up                        0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

**烟测：**

```bash
curl -I http://localhost                # 期望 200
curl -s http://localhost/api/health     # 期望 {"status":"ok",...}
```

浏览器打开 `NEXTAUTH_URL` 对应地址，点「注册」创建账号。**首个注册账号建议用邮箱**，方便忘记密码时通过邮件重置（若已配 ALIYUN_EMAIL_*）。

---

## 日常维护

### 常用命令

```bash
# 查看状态
docker compose ps

# 实时日志
docker compose logs -f app          # 应用日志
docker compose logs -f db           # 数据库日志
docker compose logs -f nginx        # Nginx 日志

# 停止（不删容器，数据保留）
docker compose down

# 重启（不重建镜像）
docker compose --env-file .env.docker up -d

# 单独重启 app
docker compose restart app

# 进入容器排查
docker exec -it aivestor-app sh
docker exec -it aivestor-db psql -U aivestor -d aivestor_db
```

### 版本更新

```bash
# 1. 拉新代码
git pull

# 2. 重建镜像并启动
docker compose --env-file .env.docker up -d --build

# 3. 若新版本含数据库迁移（db/migrations/ 新增文件），需手动跑：
docker exec -i aivestor-db psql -U aivestor -d aivestor_db < db/migrations/0XX_xxx.sql
```

> ℹ️ 升级前建议先 `pg_dump` 备份一次（见下节）。

### 数据备份

**数据库备份：**

```bash
# 备份
docker exec aivestor-db pg_dump -U aivestor aivestor_db \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复
docker exec -i aivestor-db psql -U aivestor aivestor_db < backup_20260601_120000.sql
```

**上传文件备份**（本地存储模式）：

文件保存在 Docker volume `aivestor_uploads`。导出：

```bash
docker run --rm \
  -v aivestor_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz -C /data .
```

**OSS 模式**：文件已在阿里云 OSS，按 OSS 自身的版本控制 / 跨区域复制策略管理即可。

> ⚠️ **`docker compose down -v` 会删除所有 volume，包括 pgdata 与 uploads，数据不可恢复。** 只用 `docker compose down`（不带 `-v`）即可保留数据。

---

## 常见问题排查

**Q：`docker compose up` 提示 `Could not find the file ./.env.docker`？**
A：命令必须显式带 `--env-file .env.docker`。docker compose 默认查 `.env`，不会自动认 `.env.docker`。完整命令：
```bash
docker compose --env-file .env.docker up -d --build
```

**Q：启动后访问首页显示 502 Bad Gateway 或空白？**
A：当前 Docker 编排已通过 `depends_on: condition: service_healthy` 等待 app 就绪后才接流量，正常不应出现冷启 502。若仍遇到：
1. `docker compose ps` 看 `aivestor-app` 是否 `(healthy)`；若仍 `(starting)`，再等 30 秒
2. `docker compose logs --tail=100 app`；常见根因：`DATABASE_URL` 不可达、`ENCRYPTION_KEY` 留空、数据库还在初始化

**Q：保存 API Key 报 500，日志里有 `Unsupported state or unable to authenticate data`？**
A：`ENCRYPTION_KEY` 留空或长度不对。**必须是 64 位十六进制字符串**。重新生成填入 `.env.docker`，然后：
```bash
docker compose --env-file .env.docker up -d
```

> ⚠️ 改 `ENCRYPTION_KEY` 之前**已经保存**的所有用户 API Key 都会无法解密，需要让用户重新填一次。生产环境慎改。

**Q：端口 80 被占用（`Address already in use` 或 Windows `ports are not available`）？**
A：常见占用源：IIS / Apache / Skype / Hyper-V 保留区段。最简单做法：把 nginx 端口改 8080。编辑 `docker-compose.yml`：
```yaml
nginx:
  ports:
    - "8080:80"      # 把宿主 80 改 8080
```
同步把 `.env.docker` 中 `NEXTAUTH_URL` 改为 `http://localhost:8080`，重启服务。

**Q：必须经 Nginx 端口访问吗？能直连 `http://...:3000` 吗？**
A：**不能。** Next.js 容器虽然把 3000 暴露在宿主用于调试，但 NextAuth 会用 `NEXTAUTH_URL`（默认指 :80）比对 cookie host。直连 :3000 时 host 不匹配，登录立即 401。**始终通过 `NEXTAUTH_URL` 配置的地址访问**。

**Q：镜像拉取超时或很慢（国内网络）？**
A：配置 Docker 镜像加速。Linux 编辑 `/etc/docker/daemon.json`，macOS/Windows 在 Docker Desktop → Settings → Docker Engine：
```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://mirror.ccs.tencentyun.com",
    "https://registry.cn-hangzhou.aliyuncs.com"
  ]
}
```
保存后重启 Docker，再次跑 `up -d --build`。

**Q：忘记密码（邮件未配置时）？**
A：直接在数据库重置密码哈希：
```bash
# 1. 生成新密码的 bcrypt 哈希（需要 Node.js）
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash('新密码',10).then(h=>console.log(h))"

# 2. 进 psql 更新
docker exec -it aivestor-db psql -U aivestor -d aivestor_db
```
```sql
UPDATE users SET password_hash = '<上一步输出的哈希>' WHERE email = 'user@example.com';
```

**Q：Windows 上 `setup.bat` 闪退或乱码？**
A：当前 `setup.bat` 已改为全英文交互，并在错误时停留窗口便于查看原因。若仍闪退：
1. 不要双击运行，改为打开 `cmd` → `cd` 到项目目录 → 输入 `setup.bat` 回车，这样即便首屏报错也能看到
2. 或改用 WSL2 跑 `./setup.sh`，体验更顺滑

**Q：如何启用 HTTPS？**
A：备案 + SSL 证书到位后：
1. 把证书放进 `docker/ssl/`（如 `cert.pem` + `key.pem`）
2. 编辑 `docker/nginx.conf`，取消 HTTPS server 块的注释，证书路径指向 `/etc/nginx/ssl/cert.pem`
3. 改 `.env.docker`：`NEXTAUTH_URL=https://your.domain`
4. 重启：`docker compose --env-file .env.docker up -d`
5. 推荐再加一行 HSTS（443 server 块）：
   ```nginx
   add_header Strict-Transport-Security "max-age=31536000" always;
   ```
   先跑稳 1 ~ 2 天再加 `includeSubDomains` / `preload`，留撤回空间。

---

## 获取支持

- 项目仓库：<https://github.com/zhongzhir/aivestor>
- 联系邮箱：<Aivestor@qq.com>
- 反馈部署问题时请附带：
  - `docker compose ps` 输出
  - `docker compose logs --tail=200 app` 输出
  - 操作系统 / Docker Engine 版本 / `.env.docker` 中**已脱敏**的非密钥变量
