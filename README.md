# Aivestor — 投资人的 AI 增强工作台

> **以投资人为中心，AI 赋能投资人持续进化。**  
> 面向一级股权投资专业人员的私有化 AI 工作台——不只是生成报告，而是把你每一次投资判断沉淀成可调用的资产。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-blue)](https://github.com/pgvector/pgvector)
[![Deploy](https://img.shields.io/badge/Demo-vestia--two.vercel.app-green)](https://vestia-two.vercel.app)

---

## 产品是什么

Aivestor 是专为**一级股权投资人**（VC/PE 分析师、投资经理、合伙人）构建的 AI 工作台。

它不是通用 AI 助手，也不是另一个 ChatGPT 套壳。Aivestor 做的是一件通用大模型做不了的事：**把你个人的投资判断历史、行业认知、决策逻辑，沉淀为一个越用越懂你的私有知识系统。**

你用 ChatGPT 分析一个项目，分析完就消失了。  
你用 Aivestor 分析一个项目，三年后你还能看到当初怎么判断的、哪里判断对了、哪里系统性错了。

---

## 解决什么问题

投资人在 AI 使用上面临三个结构性困境：

**① 分析结论无法沉淀**  
每次分析 BP 都从头开始。历史判断散落在邮件、备忘录、记忆里，无法检索，无法复用，无法回溯。

**② 通用 AI 不懂投资上下文**  
把 BP 丢给 ChatGPT，它不知道你的投资逻辑、偏好行业、历史踩坑。每次都要重新解释背景，输出质量参差不齐。

**③ 个人认知演变不可见**  
做了 5 年投资，你的判断框架进化了多少？哪类项目你持续高估？哪类创始人你总是看走眼？没有数据，只有感觉。

---

## 核心功能

### 📄 BP 分析与报告生成
- 上传 BP（PDF / Word / PPT / Excel），AI 自动提取关键信息
- 生成结构化七章节分析报告（市场、竞争、团队、财务、风险等）
- 流式输出，多轮对话修改，支持导出 Word / PPT
- 数据溯源标注：每个结论标记来源是文档、数据还是 AI 推断

### 🧠 私有知识库
- 每次分析自动沉淀为向量化知识条目
- 支持手动添加行业洞察、投资论点、历史经验
- 语义检索：输入"消费降级"，找到你所有相关判断
- 对话内容自动提炼，知识库越用越丰富

### 🎯 投资判断中心
- 结构化记录每个项目的多空理由、创始人评估、核心假设
- 内置决策辅助：魔鬼代言人视角、行业外视角、历史镜像对比
- 项目全生命周期追踪：从看项目到投后管理
- Outcome 记录与回溯：验证历史判断，识别认知盲区

### 🛠 SKILL 广场
- 20+ 官方投资分析框架（消费、SaaS、医疗、硬件等细分赛道）
- 支持自定义 SKILL，导入/导出，AI 辅助生成
- 从历史判断中自动生成个人专属分析框架

### 💬 跨会话持久记忆
- AI 记住你的投资偏好、关注赛道、决策风格
- 每次对话无需重新介绍背景
- 对话自动提炼为知识库条目（认知外部存储器）

---

## 与直接使用 ChatGPT 的区别

| 对比维度 | ChatGPT / 通用 AI | Aivestor |
|----------|-------------------|----------|
| **上下文记忆** | 每次对话从零开始 | 跨会话记忆你的投资偏好与历史 |
| **数据归属** | 数据在 OpenAI 服务器 | 数据主权归用户，支持私有部署 |
| **专业工作流** | 单轮对话，结构松散 | 完整工作台：上传→分析→存档→检索 |
| **历史沉淀** | 分析完即消失 | 每次判断留存，可回溯，可对比 |
| **个人化程度** | 对所有用户一样 | 越用越懂你的投资逻辑 |
| **知识复用** | 每次重新输入背景 | 私有知识库自动注入上下文 |
| **决策辅助** | 需要自己设计 prompt | 内置多角度质疑框架 |

---

## 技术架构

```
前端：Next.js 14（App Router）+ Tailwind CSS
后端：Next.js API Routes
数据库：PostgreSQL + pgvector（向量检索）
AI：用户自带 API Key（支持 DeepSeek / OpenAI / Claude / 通义 / 智谱 / Moonshot）
Embedding：阿里云百炼 text-embedding-v4（维度 1536）
认证：NextAuth.js v4（邮箱密码 / 手机号验证码）
加密：AES-256-GCM（API Key）+ bcrypt（密码）
部署：Vercel + Railway（PostgreSQL）
```

### 为什么选择"用户自带 API Key"

Aivestor 的核心理念是**数据主权归用户**。  

平台不持有你的 API 调用记录，不在服务端缓存你的对话内容，AI 调用直接从你的账号发出。这不是技术限制，是设计选择——投资分析内容高度敏感，我们不应该也不需要看到它。

---

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 14+（需要 pgvector 扩展）
- 至少一个 AI 模型的 API Key（DeepSeek 费用最低，推荐新手使用）

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/zhongzhir/investment-workbench.git
cd investment-workbench

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入数据库连接串和必要的 API Key

# 初始化数据库（按顺序执行 db/ 目录下的迁移文件）
# 推荐使用 Railway 一键部署 PostgreSQL

# 启动开发服务器
npm run dev
```

### 环境变量说明

```bash
# 数据库
DATABASE_URL=postgresql://...

# 认证
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=http://localhost:3000

# Embedding（必须，用于知识库向量检索）
BAILIAN_API_KEY=your-aliyun-bailian-key

# 邮件发送（可选，用于忘记密码功能）
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=

# 平台代付（可选，提供免费试用额度）
SYSTEM_DEEPSEEK_API_KEY=
```

详见 `.env.example`。

---

## 产品截图

> 内测中，截图更新于 2026年5月

| 模块 | 说明 |
|------|------|
| Dashboard | 项目概览、活跃提醒、快速入口 |
| 项目分析 | 上传 BP → 生成报告 → 多轮修改 → 导出 |
| 项目档案 | 全生命周期记录，支持投委会总报告合并生成 |
| 知识库 | 私有知识沉淀与语义检索 |
| SKILL 广场 | 官方框架 + 自定义分析模板 |
| 个人设置 | 投资画像配置，AI 行为个性化 |

---

## 路线图

- [x] BP 上传与 AI 分析报告（七章节结构）
- [x] 私有知识库（向量检索 + 自动沉淀）
- [x] 跨会话持久记忆
- [x] SKILL 广场（20 官方框架 + 自定义）
- [x] 投资判断中心（多空记录 + Outcome 追踪）
- [x] 报告数据溯源标注
- [x] 投委会总报告生成
- [x] 手机号验证码登录 + 平台代付免费额度
- [ ] 本地化部署版（Docker Compose + Ollama）
- [ ] SKILL 社区（GP 分享投资框架）
- [ ] 跨项目财务对比
- [ ] 移动端 App（PWA 已支持）

---

## 设计理念

### 数据主权 > 功能丰富

大模型厂商提供的 AI 工具越来越强，功能上我们无法竞争。但有一件事大模型厂商永远不会做：**让你把自己的投资判断数据放在自己控制的地方。**

Aivestor 的长期目标是支持完全本地化部署——你的数据跑在你自己的服务器上，不依赖任何第三方云服务，满足机构合规要求。

### 工具 vs 习惯

好的工具不只是省时间，而是让使用者本身变得更好。  
Aivestor 的设计目标不是替代投资人的判断，而是让判断过程变得可记录、可反思、可进化。

---

## 参与内测

目前处于**邀请制内测**阶段，通过 [vestia-two.vercel.app](https://vestia-two.vercel.app) 访问。

如果你是一级市场从业者（VC/PE/CVC），欢迎联系申请内测资格：

- 📧 Email：[Aivestor@qq.com](mailto:Aivestor@qq.com)
- 🌐 官网：[aivestor.cn](https://aivestor.cn)（备案中，即将上线）

内测用户享有：免费使用额度（无需自备 API Key）、优先体验新功能、直接与产品团队沟通反馈渠道。

---

## 贡献

欢迎提交 Issue 和 PR。开源计划待产品稳定后推进，敬请期待。

---

## License

Apache License 2.0 — 详见 [LICENSE](LICENSE)（附 [NOTICE](NOTICE)）

---

<div align="center">
  <sub>Built for investors, by investors. · <a href="mailto:Aivestor@qq.com">Aivestor@qq.com</a></sub>
</div>
