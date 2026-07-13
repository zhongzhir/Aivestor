# Aivestor 2.0 上线后系统与代码审计报告

审计日期：2026-07-13
审计基线：`69b63e5 feat(project): add relationship and knowledge context`
生产环境：ECS + PM2 + Nginx，Node `v22.23.1`

## 一、结论

核心版本已完成构建并上线，健康检查正常；但当前不建议直接宣布“无安全风险”。静态审计发现 1 项高优先级安全问题，另有 3 项中低优先级问题需要进入修复队列。

当前结论：**系统可运行，核心流程已上线；安全修复完成前不建议扩大外部用户范围。**

## 二、已验证项目

- ECS 拉取版本为 `69b63e5`。
- 数据库迁移 `041_project_relationships.sql` 已应用。
- ECS Node `v22.23.1`、npm `10.9.8`。
- `npm run build` 通过，Next.js 页面和 API 路由生成成功。
- PM2 `aivestor` 状态为 `online`。
- `http://127.0.0.1:3000/api/health` 返回 `200`。
- `https://aivestor.cn/api/health` 返回 `200`。
- 未登录访问 `/projects` 返回登录跳转 `307`，符合预期。
- 本地 `npx tsc --noEmit` 通过。
- 已检查认证中间件、项目资源权限、组织资源权限、上传路径校验和安全响应头。

## 三、问题清单

### P1：文档解析接口存在 SSRF 风险（已修复，待线上验证）

位置：`src/app/api/projects/[id]/documents/route.ts`、`src/lib/fileStorage.ts`

`POST /api/projects/[id]/documents` 接收客户端提交的 `blobUrl`，随后调用 `readFileBuffer(blobUrl)`。`readFileBuffer` 对非 `oss://`、非 `local://` 的地址直接执行服务端 `fetch`。当前只校验文件类型，不限制目标域名或私有地址。

风险：攻击者在拥有普通账号后，可尝试让服务端访问内网服务、云实例元数据地址或其他受限 HTTP 服务，并将结果带入解析流程。

本轮修复：

1. 非 OSS/local 文件地址必须使用 HTTPS，并且主机必须命中 `DOCUMENT_REMOTE_ALLOWED_HOSTS` 或受限的 Vercel Blob 域名。
2. 禁止 localhost、常见私网地址、云元数据地址和 HTTP 重定向。
3. 增加 30 秒超时和 25MB 响应大小限制。
4. 解析失败时不再向客户端返回内部 `stack`。

待线上验证：使用 ECS 实际上传链路确认生产文件地址属于允许主机；如生产使用自定义 OSS HTTPS 域名，需要在 `.env.local` 增加 `DOCUMENT_REMOTE_ALLOWED_HOSTS`。

### P2：上传内容校验不足（已修复主要风险，待长期资源隔离）

位置：`src/app/api/upload-local/route.ts`、`src/app/api/upload-url/route.ts`

本轮已增加 PDF、Office ZIP/OLE 文件签名校验、远程读取大小限制，以及按用户维度的 10 分钟上传/解析频率限制。长期仍建议增加独立的解析资源隔离和压缩炸弹防护。

建议：统一使用文件签名检测，限制解析资源和请求频率，并对上传、解析、图片识别增加审计日志和失败计数。

### P2：依赖安全告警尚未收敛

ECS `npm ci` 已报告 10 个漏洞：4 moderate、5 high、1 critical。不能直接使用 `npm audit fix --force`，应先生成依赖树，逐项确认是否会升级 Next.js、解析器或导出链路。

本地 Node 14 环境执行 `npm audit` 时还出现 npm 客户端自身的 `Cannot read property '@anthropic-ai/sdk' of undefined`，因此依赖结果应以 ECS Node 22 环境重新执行为准。

### P3：缺少自动化回归测试资产

仓库未发现项目自有的 `tests`、`*.spec.ts` 或 `*.test.ts` 回归测试文件；当前验证主要依赖 TypeScript、生产构建、健康检查和人工页面验证。

建议至少补充：认证访问、项目权限、文档上传、关系记录、知识卡片和投后报告输出的 API 回归测试。

## 四、暂未发现的高风险问题

- 项目级 API 普遍使用 `getSession` 和 `assertProjectAccess` 进行访问控制。
- 项目子资源使用组织范围和用户范围的组合条件，未发现本次新增关系记录接口绕过项目权限的路径。
- 本地文件存储对路径进行了规范化和根目录约束，未发现明显路径穿越路径。
- 已配置 `X-Frame-Options`、`X-Content-Type-Options`、Referrer-Policy 和 Permissions-Policy。
- 未发现 `eval`、`new Function` 或直接执行系统命令的业务代码。

## 五、线上审计缺口

以下项目需要在具备两个测试账号的浏览器环境中完成，当前仅做了代码和公共健康检查，不能替代真实越权回归：

- 个人用户 A 访问用户 B 的项目、报告、文档、知识和关系记录。
- 组织 analyst、partner、admin 三种角色的读写边界。
- 文件上传、报告导出和投后报告审核的跨账号访问。
- 登录失效、改密后旧会话失效、验证码重放和频率限制。
- 移动端和主要浏览器的页面流程回归。

## 六、建议修复顺序

1. 先修复文档解析 SSRF，并补充请求超时、大小限制和错误信息收敛。
2. 再完善上传文件签名校验与频率限制。
3. 在 ECS Node 22 环境逐项处理 npm 漏洞。
4. 建立最小 API 回归测试集。
5. 使用两个个人账号和三个组织角色完成线上越权回归。
