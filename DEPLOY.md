# Aivestor 本地化部署指南

> 数据完全存储在你自己的服务器，AI 调用仍通过你的 API Key 访问外部服务。

## 前置条件

- Docker Desktop（[下载地址](https://www.docker.com/products/docker-desktop/)）
- 2核4G 及以上内存（本机或服务器均可）

---

## 方式一：一键配置（推荐新手）

运行配置脚本，全程引导，自动生成所有密钥，只需回答 2-3 个问题。

**Mac / Linux：**
```bash
git clone https://github.com/zhongzhir/Aivestor.git
cd Aivestor
chmod +x setup.sh
./setup.sh
```

**Windows：**
```
1. 下载并解压代码
2. 双击运行 setup.bat
3. 按提示操作
```

脚本完成后，直接执行第 3 步启动。

---

## 方式二：手动配置（适合有技术背景的用户）

### 1. 克隆代码

```bash
git clone https://github.com/zhongzhir/Aivestor.git
cd Aivestor
```

### 2. 配置环境变量

```bash
cp .env.docker.example .env.docker
nano .env.docker   # 填写必填项
```

**必填项：**

| 变量 | 说明 | 生成方式 |
|------|------|----------|
| `DB_PASSWORD` | 数据库密码 | 自定义，12位以上 |
| `NEXTAUTH_URL` | 访问地址 | 如 `http://192.168.1.100` |
| `NEXTAUTH_SECRET` | JWT 密钥 | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 加密主密钥 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BAILIAN_API_KEY` | 百炼 Embedding | [申请地址](https://bailian.console.aliyun.com/) |

### 3. 构建并启动

```bash
docker compose --env-file .env.docker up -d --build
```

首次启动约需 3-5 分钟（构建镜像）。

### 4. 访问

浏览器打开 `http://你的IP`，注册账号即可使用。

---

## 文件存储配置（推荐）

不配置 OSS 则无法上传 BP 文件。推荐使用阿里云 OSS：

1. 创建 OSS Bucket（私有读写）
2. 创建 RAM 子账号，授权 `AliyunOSSFullAccess`
3. 在 `.env.docker` 填入 `OSS_REGION` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET`
4. OSS 跨域设置中添加你的服务器 IP 来源

---

## HTTPS 配置（备案后）

1. 将 SSL 证书（`.pem` 和 `.key`）放入 `docker/ssl/` 目录
2. 取消 `docker/nginx.conf` 中 HTTPS server 块的注释
3. 将 `NEXTAUTH_URL` 改为 `https://aivestor.cn`
4. 重启服务：`docker compose --env-file .env.docker up -d`

---

## 常用命令

```bash
# 查看运行状态
docker compose ps

# 查看应用日志
docker compose logs -f app

# 停止服务
docker compose down

# 更新到最新版本
git pull
docker compose --env-file .env.docker up -d --build

# 备份数据库
docker exec aivestor-db pg_dump -U aivestor aivestor_db > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker exec -i aivestor-db psql -U aivestor aivestor_db < backup_20260101.sql
```

---

## 数据目录

数据库数据存储在 Docker volume `pgdata` 中，删除容器不会丢失数据。

如需迁移数据：
```bash
# 导出
docker run --rm -v aivestor_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tar.gz -C /data .

# 导入（新服务器）
docker run --rm -v aivestor_pgdata:/data -v $(pwd):/backup alpine tar xzf /backup/pgdata.tar.gz -C /data
```
