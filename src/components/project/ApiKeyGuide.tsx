"use client";

import { useState } from "react";

interface ProviderRow {
  name: string;
  model: string;
  scene: string;
  access: string;
}

const PROVIDERS: ProviderRow[] = [
  { name: "DeepSeek", model: "deepseek-chat", scene: "中文报告生成，性价比最高", access: "✅ 直接访问" },
  { name: "通义千问", model: "qwen-max", scene: "中文理解，阿里云生态", access: "✅ 直接访问" },
  { name: "豆包（火山引擎）", model: "doubao-pro", scene: "中文场景，字节生态", access: "✅ 直接访问" },
  { name: "Moonshot（Kimi）", model: "moonshot-v1", scene: "长文档处理", access: "✅ 直接访问" },
  { name: "智谱 AI", model: "glm-4", scene: "中文理解，国产模型", access: "✅ 直接访问" },
  { name: "OpenAI", model: "gpt-4o", scene: "综合能力强", access: "⚠️ 需代理" },
  { name: "Claude", model: "claude-sonnet", scene: "长文档分析，逻辑推理", access: "⚠️ 需代理" },
  { name: "Gemini", model: "gemini-pro", scene: "Google 生态", access: "⚠️ 需代理" },
  { name: "Mistral", model: "mistral-large", scene: "欧洲合规场景", access: "⚠️ 需代理" },
];

interface KeyLink {
  name: string;
  url?: string;
  steps: string;
}

const KEY_LINKS: KeyLink[] = [
  { name: "DeepSeek", url: "https://platform.deepseek.com", steps: "注册 → API Keys → 创建" },
  { name: "通义千问", url: "https://dashscope.aliyun.com", steps: "注册 → API Key 管理" },
  { name: "豆包", url: "https://console.volcengine.com", steps: "注册 → 模型推理 → API Key" },
  { name: "Moonshot", url: "https://platform.moonshot.cn", steps: "注册 → API Keys" },
  { name: "智谱 AI", url: "https://open.bigmodel.cn", steps: "注册 → API Keys" },
  { name: "OpenAI", url: "https://platform.openai.com", steps: "注册（需境外手机号）→ API Keys" },
  { name: "Claude", url: "https://console.anthropic.com", steps: "注册（需境外手机号）→ API Keys" },
  { name: "其他服务商", steps: "请参照各服务商官方文档中的 API Key 申请说明" },
];

const NOTES: string[] = [
  "API Key 请勿分享给他人，泄露后立即在服务商控制台删除重建",
  "系统使用 AES-256-GCM 加密存储你的 API Key，不会以明文保存",
  "国内用户推荐优先使用 DeepSeek、通义千问、豆包等国产服务商，无需代理，稳定性更好",
  "OpenAI、Claude、Gemini 等境外服务在中国大陆无法直连，需自行配置网络代理",
  "API 调用会产生费用，由你的服务商账户直接扣除，与平台无关",
  "建议在服务商控制台设置用量上限，避免意外超支",
  "其他兼容 OpenAI 接口标准的模型服务均可接入，配置方式类似，请参照各服务商官方文档",
];

export function ApiKeyGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-ink">如何配置 API Key</span>
        <span className="text-xs text-ink-faint">
          {open ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>

      {open && (
        <div className="space-y-6 border-t border-line px-4 py-4">
          {/* 支持的服务商 */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              支持的服务商
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-faint">
                    <th className="py-2 pr-3 text-left font-medium">服务商</th>
                    <th className="py-2 pr-3 text-left font-medium">推荐模型</th>
                    <th className="py-2 pr-3 text-left font-medium">适合场景</th>
                    <th className="py-2 text-left font-medium">国内访问</th>
                  </tr>
                </thead>
                <tbody>
                  {PROVIDERS.map((p) => (
                    <tr key={p.name} className="border-b border-line/60">
                      <td className="py-2 pr-3 text-ink">{p.name}</td>
                      <td className="py-2 pr-3 text-ink-soft">{p.model}</td>
                      <td className="py-2 pr-3 text-ink-soft">{p.scene}</td>
                      <td className="py-2 text-ink-soft">{p.access}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 获取 API Key */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              获取 API Key
            </h3>
            <ul className="mt-3 space-y-1.5 text-xs text-ink-soft">
              {KEY_LINKS.map((k) => (
                <li key={k.name}>
                  <span className="font-medium text-ink">{k.name}</span>
                  {k.url && (
                    <>
                      ：
                      <a
                        href={k.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {k.url.replace("https://", "")}
                      </a>
                    </>
                  )}
                  <span>
                    {k.url ? " → " : "："}
                    {k.steps}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 注意事项 */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              注意事项
            </h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-ink-soft">
              {NOTES.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
