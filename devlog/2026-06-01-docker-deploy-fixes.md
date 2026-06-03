# 2026-06-01 · Docker 本地化部署修复 + Landing 本地模式

> 起因：V3.0（2026-05-31）刚发布 Docker Compose 本地化部署，在 Cowork 会话里
> 对照 `AIVESTOR_CONTEXT.md` 走读了一遍新加入的 Dockerfile / docker-compose /
> setup 脚本 / fileStorage 等文件，发现一组阻断性 + 安全 + 体验问题。

涉及 commit：
- `9019ad4` fix(docker): standalone 构建 + 本地存储 volume 与权限 + ali-oss 依赖
- `20c90a9` fix(security,docs): upload-local 路径遍历校验 + 部署文档与脚本对齐
- `12936e1` chore(p2): 本地化部署文案/编码/版本一致性 + Landing 本地模式开关

---

## 一、P0 — 阻断 docker compose up 的问题

### 1. Dockerfile 缺 NEXT_OUTPUT=standalone
`next.config.mjs` 是条件输出：`output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined`。
Dockerfile builder 阶段没设这个变量，`npm run build` 不会产出 `.next/standalone/`，
随后 runner 阶段 `COPY --from=builder /app/.next/standalone ./` 必然失败。

**修复**：builder 阶段加 `ENV NEXT_OUTPUT=standalone`。

### 2. uploads volume 挂错了服务
`docker-compose.yml` 把 `uploads:/app/uploads` 挂在了 **db** 服务上，而真正写入
该路径的是 **app** 服务（且 app 服务原本完全没有 volume 段）。本地降级模式下
BP 文件写到 app 容器的临时层，重启容器即丢失。同时违背"数据完全在本机"承诺。

**修复**：把 volume 挂载从 db 移到 app。

### 3. /app/uploads 属主不是 nextjs 用户
Dockerfile 用 `USER nextjs`（uid 1001）运行，但 `/app` 是 root 创建的 WORKDIR，
没有 mkdir + chown，首次写盘 EACCES。

**修复**：runner 阶段加 `RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads`。
（运行期 volume 第一次创建会继承挂载点属主，所以这一步仍必要。）

### 4. package.json 缺 ali-oss 运行时
仓库里只有 `@types/ali-oss` 没有 `ali-oss` 本体。webpack 静态分析阶段就报
`Module not found: Can't resolve 'ali-oss'`，本地 + Docker 都 build 不过。
（ECS 服务器能跑是因为手动 `npm install ali-oss` 过但没固化到 lock。）

**修复**：dependencies 加 `ali-oss ^6.23.0` 并 `npm install` 落锁。

---

## 二、P1 — 安全与文档

### 5. upload-local 路径遍历
`saveLocalFile(objectKey, buffer)` 信任客户端传入的 `objectKey`，攻击者可伪造
`objectKey=../../etc/passwd` 写盘任意位置。`path.join` 不阻止 `..`。

**修复**：`fileStorage.ts` 的 `saveLocalFile` 与 `readFileBuffer` 双重校验：
- `path.posix.normalize` 后拒绝 `..` 前缀 / NUL 字符 / 绝对路径
- `path.resolve` 后必须落在 `LOCAL_UPLOAD_DIR` 内（前缀校验）

5 个用例本地验证：合法 PASS×2 / 越界 BLOCK×3。

### 6. DEPLOY.md 落后于代码
- "BAILIAN_API_KEY 必填" — 但 V3.0 已支持降级关键词搜索
- "不配置 OSS 则无法上传 BP 文件" — 但 V3.0 已支持本地磁盘降级

**修复**：拆出"必填/可选"两表，明确每个可选变量的降级行为。

### 7. setup.bat 强依赖 Node.js
新手装 Docker Desktop 大概率没装 Node，脚本检测失败直接退出，与"一键"承诺矛盾。

**修复**：改用 PowerShell 内置 `[Security.Cryptography.RandomNumberGenerator]`
生成三个密钥。Windows 10/11 自带 PowerShell。

---

## 三、P2 — 一致性 / 体验细节

### 8. NEXT_PUBLIC_LANDING_MODE=local：跳过 SaaS 落地页
本地化部署用户登录前会看到 `aivestor.cn` JSON-LD、"备案中"FAQ 这些 SaaS 文案，
明显不符合自建场景。

**修复**：`(app)/page.tsx` 在 `NEXT_PUBLIC_LANDING_MODE === "local"` 时
`redirect("/login")` 跳过 LandingPage。docker-compose 默认设为 `local`，
Vercel/SaaS 部署不设此变量，行为不变。

### 9. 必须经 Nginx 访问的提示
用户直连 `http://host:3000` 会因为 NextAuth cookie 域名校验立刻 401。
DEPLOY.md 之前没说。

**修复**：访问段加 ⚠️ 警告 + 端口冲突时改 8080 的替代方案。

### 10. 数据库版本注释不一致
- README.md：PG 14+
- docker/init.sql：PG 15+
- docker-compose：pg16
- 阿里云 ECS 现状：PG 14

**修复**：init.sql 统一为 14+，注明 docker-compose 用 pg16。

### 11. ali-oss 不必要的 bundle 占用
`require("ali-oss")` 在 `isOSSEnabled()=false` 路径上不会触发，但 webpack 会静态分析
并把它打入 server bundle。

**修复**：next.config.mjs 把 `ali-oss` 加入 `serverComponentsExternalPackages`，
彻底交给 Node 运行时 require。

### 12. 其他小项
- `setup.sh` 注释"16 位"→ 实际 20 位，对齐
- `docker-compose.yml` 顶部 `version: "3.9"` 已废弃，删除
- `setup.bat` 用 PowerShell + UTF8(无 BOM) 写出 `.env.docker`，避免 cmd
  重定向在中文系统上产生 GBK 乱码

---

## 四、未完成 / 留给下次

1. **整链路冒烟未跑**：本机 Docker daemon 未启动，没跑成
   `docker compose --env-file .env.docker up -d --build`。
   静态阻断点都验证过了，但完整闭环（注册 → 上传 BP → 重启容器 → 文件仍在）需要
   在 daemon 在线的机器上跑一次。
2. **ali-oss 真瘦身**：当前只防 webpack 误打包，没让 `node_modules` 真变小。
   后续可考虑迁到 `optionalDependencies`，文档里写明
   `docker build --build-arg NPM_FLAGS=--omit=optional`。属于独立小重构。
3. **Landing 本地化更深定制**：当前是"local 就跳过"。如果想做"自托管也有自己的
   品牌落地页"，需要给 LandingPage 抽出文案 props。暂无需求。

---

## 五、验证记录

- 本地 `npm run build`（NEXT_OUTPUT=standalone）→ 51 路由全编译成功，
  `.next/standalone/server.js` 产出 ✅
- `docker compose --env-file .env.docker.test config` → 配置树解析正确，
  app.volumes 出现 `uploads → /app/uploads` ✅
- 路径遍历 5 用例本地 Node 脚本验证 ✅
- setup.bat 改用 PowerShell 写出测试文件，首 3 字节 `23 20 41`（`# A`），
  无 BOM，中文显示正常 ✅
