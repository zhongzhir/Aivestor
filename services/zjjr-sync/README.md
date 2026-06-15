# zjjr-sync — 中鉴基金研究院数据同步服务

独立 Node 进程，与主应用（Next.js）**完全解耦**：独立 `package.json`、独立依赖、不进 Next.js 构建（根 `tsconfig.json` 已 `exclude: ["services"]`）。架构依据：`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md` v1.1 第五部分。

> **本期（P5）为骨架 + Fixture**：中鉴 API 文档未到位，`HttpZjjrClient` 未实现（方法全部 throw）。用 `FixtureZjjrClient` 读 `fixtures/sample.json` 即可端到端打通全管道。

## 目录

```
services/zjjr-sync/
├── package.json            # 独立依赖（仅 pg + ts-node + typescript）
├── tsconfig.json
├── ecosystem.config.js     # PM2：cron_restart "30 2 * * *"，autorestart:false
├── src/
│   ├── client.ts           # ZjjrClient 接口 + FixtureZjjrClient + HttpZjjrClient(stub) + createClient()
│   ├── db.ts               # 专用账号连接池 + 事务辅助
│   ├── types.ts            # 内部领域类型（不 import 主应用）
│   ├── sync-core.ts        # 流水线编排 + sync_log 管理
│   ├── full-sync.ts        # 全量初始化入口（首次全量后建 ivfflat 索引）
│   ├── incremental-sync.ts # 增量同步入口（读 watermark）
│   ├── insights.ts         # 市场洞察预生成（P6 骨架）
│   └── pipeline/
│       ├── clean.ts        # 清洗（全角规范化 / 日期解析失败入 raw 不丢弃）
│       ├── resolve.ts      # 实体解析（三级匹配：source_id / canonical / pg_trgm>0.85 进 pending）
│       ├── extract.ts      # 特征提取（近12月出手 / 轮次分布 / 赛道集中度 / 赛道近90天）
│       ├── narrate.ts      # 自然语言化（模板，200–400 字，内置数据截止日 + 有效期）
│       ├── embed.ts        # 向量化（百炼 text-embedding-v4 1536 维，独立实现）
│       └── write.ts        # 双轨写入（结构化 upsert + 特征先删后插）+ ensureEmbeddingIndex
├── fixtures/
│   └── sample.json         # 6 家虚构机构 + 7 笔投资（含 VC/PE/CVC/政府引导基金 + 消歧用例）
└── scripts/
    └── smoke-test.ts       # P5 验收冒烟测试
```

## 隔离红线（架构文档 3.2 / 5.2 — code review 红线）

1. **专用 DB 账号**：本服务用 `zjjr_sync` 账号连接（对 `zjjr_*` 全权限、对业务表零权限）。
   生产环境设置 `ZJJR_SYNC_DATABASE_URL=postgres://zjjr_sync:<pwd>@host/db`。
   **切勿复用主应用 `DATABASE_URL`** —— 那会打穿账号隔离。
2. **主应用对 `zjjr_*` 仅 SELECT**：账号创建与 GRANT 语句见迁移 `028_zjjr_pipeline.sql` 文件末尾「人工执行」段，由 DBA 在生产库手动落实。
3. **数据单向**：用户/机构数据永不写入 `zjjr_*`；中鉴层对 AI 只读，不回写。

## 环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `ZJJR_SYNC_DATABASE_URL` | 专用账号连接串（生产必填） | 回退 `DATABASE_URL`（仅本地） |
| `DATABASE_URL` | 本地 smoke-test 连接串 | — |
| `BAILIAN_API_KEY` | 百炼向量化密钥（与主应用同一约定） | 未配置则降级为纯文本（仍可全文检索） |
| `ZJJR_CLIENT` | `fixture`（默认）/ `http`（待 API 实现后） | `fixture` |
| `ZJJR_API_BASE_URL` / `ZJJR_API_KEY` | HttpZjjrClient 用（待实现） | — |

## 部署前置

1. **迁移 028 已在生产库手动执行**（含 `CREATE EXTENSION pg_trgm`）。
2. **DBA 执行账号创建 + GRANT**（迁移 028 末尾「人工执行」段）。
3. `npm install && npm run build`（产物在 `dist/`，PM2 跑 `dist/incremental-sync.js`）。
4. `pm2 start ecosystem.config.js`（每日 02:30 增量；首次需先手动跑一次 full-sync 建 ivfflat 索引）。

## 本地冒烟测试（P5 验收 A6）

```powershell
cd services/zjjr-sync
npm install
# 确保本地库已执行迁移 028
$env:DATABASE_URL = "postgres://user:pwd@localhost:5432/aivestor"
# 可选：$env:BAILIAN_API_KEY = "sk-..."（不配则降级纯文本，仍可跑通）
npx ts-node scripts/smoke-test.ts
```

预期输出：Fixture 读取 → 流水线写入 → `zjjr_features` 有行 → 有效期内特征可检索且带「中鉴基金研究院」来源标注 → `✅ 全部通过`。

主应用侧验证（A5）：登录某开通 `zjjr_data` 能力位的组织成员，在 `/knowledge` 检索 → 命中结果含 `【中鉴数据】` 层来源；无能力位或 `zjjr_features` 为空时静默不出该层、不报错。

## HttpZjjrClient 待实现 —— 7 项待 API 文档确认清单

见架构文档 5.3 表格（`docs/architecture/INSTITUTIONAL_ARCHITECTURE.md`）：

1. 字段结构（机构/投资事件完整字段字典与枚举值）→ `clean.ts` 的 raw→结构化映射键
2. 分页方式（cursor / page+pageSize / scroll）→ `ZjjrPage` 形状与翻页循环
3. 限流规则（QPS、日配额、429 行为）→ 同步节奏与退避重试
4. 增量查询支持（是否有 updated_since）→ `fetchUpdates` 实现方式
5. 认证方式（API Key header / 签名 / OAuth；轮换机制）→ 客户端配置与密钥管理
6. `source_id` 稳定性（是否永不变更）→ upsert 对账键可靠性
7. 数据使用协议边界（可否落库缓存、展示字段范围、免责声明）→ 点查字段范围与文案合规

实现位置：`src/client.ts` 的 `HttpZjjrClient`（当前各方法 throw `"待 API 文档到位后实现"`）。
