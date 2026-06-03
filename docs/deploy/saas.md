# SaaS 版（推荐）

直接访问 [aivestor.cn](https://aivestor.cn) 注册使用，无需任何部署。

## 免费额度

注册后绑定手机号，获得平台代付的 DeepSeek 免费使用额度（**500万 tokens**），一般用户够用 1-2 个月。

## 配置自己的 API Key

如需使用更多模型或更大用量，可在「个人设置」中配置自己的 API Key：

| 支持的平台 | 模型 | 备注 |
|-----------|------|------|
| DeepSeek | deepseek-chat | 速度快，成本低，推荐 |
| OpenAI | GPT-4o 等 | 需能访问 OpenAI |
| Anthropic | Claude 系列 | 需能访问 Anthropic |
| 通义千问 | qwen-max 等 | 阿里云平台 |
| 智谱 AI | GLM-4 等 | 国内平台 |
| Moonshot | moonshot-v1 | 国内平台 |

**API Key 安全说明：** 使用 AES-256-GCM 加密存储，只在调用时服务端临时解密，不记录日志，不明文传输。

## 文件存储

SaaS 版使用阿里云 OSS 存储，单文件最大 **25MB**，支持浏览器直传，不占用服务器带宽。
