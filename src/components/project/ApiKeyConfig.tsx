"use client";

import { useEffect, useState } from "react";
import { formatTokens } from "@/lib/tokensFormat";

interface QuotaStatus {
  enabled: boolean;
  available?: boolean;
  tokensUsed?: number;
  tokensLimit?: number;
  tokensRemaining?: number;
  reason?: string;
}

interface ProviderDef {
  value: string;
  label: string;
  defaultBaseUrl?: string;
  pattern?: RegExp;
  hint?: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    value: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    pattern: /^sk-[a-zA-Z0-9]{32,}$/,
    hint: "DeepSeek API Key 应以 sk- 开头",
  },
  {
    value: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    pattern: /^sk-[a-zA-Z0-9\-_]{20,}$/,
    hint: "OpenAI API Key 应以 sk- 开头",
  },
  {
    value: "qwen",
    label: "通义千问",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    pattern: /^sk-[a-zA-Z0-9]{32,}$/,
    hint: "通义千问 API Key 应以 sk- 开头",
  },
  {
    value: "claude",
    label: "Claude",
    pattern: /^sk-ant-[a-zA-Z0-9\-_]{80,}$/,
    hint: "Anthropic API Key 应以 sk-ant- 开头",
  },
  {
    value: "zhipu",
    label: "智谱 AI（GLM）",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    pattern: /^[a-zA-Z0-9]{20,}\.[a-zA-Z0-9]{16,}$|^sk-[a-zA-Z0-9]{20,}$/,
    hint: "智谱 AI Key 形如 xxx.yyy 或 sk- 开头",
  },
  {
    value: "moonshot",
    label: "Moonshot（Kimi）",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    pattern: /^sk-[a-zA-Z0-9]{32,}$/,
    hint: "Moonshot API Key 应以 sk- 开头",
  },
  {
    value: "ctyun",
    label: "天翼 Token 套餐",
    defaultBaseUrl: "https://api.ctyun.cn/v1",
  },
];

const JSON_HEADERS = { "Content-Type": "application/json" };

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; sample?: string }
  | { phase: "fail"; error: string };

export function ApiKeyConfig({
  onChange,
}: {
  onChange?: (configured: boolean) => void;
}) {
  const [provider, setProvider] = useState("deepseek");
  const [newKey, setNewKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testState, setTestState] = useState<TestState>({ phase: "idle" });
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  async function refresh() {
    const res = await fetch("/api/user/api-key");
    if (!res.ok) return;
    const data = await res.json();
    const p = data.provider || "deepseek";
    setProvider(p);
    setMaskedKey(data.maskedKey);
    setConfigured(!!data.configured);
    // 优先用户已保存的 baseUrl；否则用 provider 默认
    const def = PROVIDERS.find((x) => x.value === p)?.defaultBaseUrl ?? "";
    setBaseUrl(data.baseUrl ?? def);
    onChange?.(!!data.configured);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // 拉一次免费额度状态；失败静默忽略
    fetch("/api/user/quota-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setQuota(d))
      .catch(() => setQuota(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换 provider 时自动预填 Base URL（仅当当前 baseUrl 是某个已知默认值或为空）
  function onProviderChange(next: string) {
    const prevDefault = PROVIDERS.find((p) => p.value === provider)?.defaultBaseUrl ?? "";
    const nextDefault = PROVIDERS.find((p) => p.value === next)?.defaultBaseUrl ?? "";
    if (!baseUrl || baseUrl === prevDefault) {
      setBaseUrl(nextDefault);
    }
    setProvider(next);
    setTestState({ phase: "idle" });
  }

  const currentProvider = PROVIDERS.find((p) => p.value === provider);
  const keyMatchesPattern = currentProvider?.pattern
    ? currentProvider.pattern.test(newKey.trim())
    : null;

  async function handleSave() {
    setError("");
    setMessage("");
    if (!configured && !newKey.trim()) {
      setError("请输入 API Key");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/api-key", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          apiKey: newKey.trim() || undefined,
          provider,
          baseUrl: baseUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error || "保存失败");
      }
      setNewKey("");
      await refresh();
      setMessage("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    const key = newKey.trim();
    if (!key) {
      setError("请先输入要测试的 API Key");
      return;
    }
    setError("");
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          provider,
          apiKey: key,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestState({ phase: "ok", sample: data.sample });
        window.setTimeout(() => setTestState({ phase: "idle" }), 4000);
      } else {
        setTestState({ phase: "fail", error: data.error || "连接失败" });
      }
    } catch (e) {
      setTestState({
        phase: "fail",
        error: e instanceof Error ? e.message : "连接失败",
      });
    }
  }

  const showHighlight = !loading && !configured;

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        showHighlight
          ? "border-[#1B6FE8] ring-2 ring-[#1B6FE8]/20"
          : "border-slate-200"
      }`}
    >
      {/* 免费额度横幅：仅在用户未配置自己的 Key + 系统已启用代付时显示 */}
      {!loading && !configured && quota?.enabled && quota.available && (
        <div className="mb-3 rounded-r-lg border-l-4 border-[#3d7a5e] bg-[#3d7a5e10] p-3">
          <p className="text-sm font-medium text-[#3d7a5e]">
            🎁 你有 {formatTokens(quota.tokensRemaining ?? 0)} 免费额度可用
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            无需配置即可体验全部功能，额度用完后需配置自己的 API Key
          </p>
        </div>
      )}
      {!loading && !configured && quota?.enabled && quota.available === false && (
        <div className="mb-3 rounded-r-lg border-l-4 border-[#FF6B35] bg-orange-50 p-3">
          <p className="text-sm font-medium text-[#FF6B35]">
            免费额度已用完，配置自己的 API Key 后可无限使用，数据完全归您所有。
            <a href="/settings" className="ml-1 underline hover:opacity-80">
              前往设置 →
            </a>
          </p>
        </div>
      )}

      {showHighlight && (
        <div className="mb-3 rounded-lg border-l-4 border-[#1B6FE8] bg-[#1B6FE808] px-3 py-2 text-xs text-blue-700">
          ⚠️ 配置 API Key 后即可使用 AI 功能
        </div>
      )}

      <div className="text-sm font-medium text-ink">AI 模型与 API Key</div>
      <p className="mt-1 text-xs text-ink-faint">
        Key 经 AES-256-GCM 加密后存储，页面仅显示脱敏值。
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-xs text-ink-soft">服务商</label>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            disabled={loading || saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-soft">API Key</label>
          {configured && (
            <p className="mb-1 text-xs text-ink-faint">
              当前已保存：
              <span className="font-mono text-ink-soft">{maskedKey}</span>
            </p>
          )}
          <input
            type="password"
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setTestState({ phase: "idle" });
            }}
            disabled={loading || saving}
            placeholder={configured ? "输入新 Key 可替换" : "sk-..."}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {newKey.trim() && keyMatchesPattern === true && (
            <p className="mt-1 text-xs text-green-600">✓ 格式正确</p>
          )}
          {newKey.trim() && keyMatchesPattern === false && (
            <p className="mt-1 text-xs text-orange-600">
              ⚠ {currentProvider?.hint ?? "请检查 Key 格式"}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-soft">
            Base URL（可选）
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={loading || saving}
            placeholder={currentProvider?.defaultBaseUrl ?? "默认值（按服务商）"}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {provider === "ctyun" && (
            <p className="mt-1 text-xs text-slate-500">
              天翼 Token 套餐请填写：{" "}
              <code className="font-mono">https://api.ctyun.cn/v1</code>
              （请以天翼云官方文档为准）
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {message && <p className="text-xs text-green-600">{message}</p>}
        {testState.phase === "fail" && (
          <p className="text-xs text-red-600">连接失败：{testState.error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="rounded-lg bg-[#1B6FE8] px-4 py-1.5 text-sm font-medium tracking-[0.01em] text-white transition-colors duration-150 hover:bg-[#1762d0] disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            onClick={testConnection}
            disabled={
              loading || saving || testState.phase === "testing" || !newKey.trim()
            }
            className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:opacity-50 ${
              testState.phase === "ok"
                ? "border-green-500 bg-green-50 text-green-700"
                : testState.phase === "fail"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-slate-200 text-ink-soft hover:bg-slate-50"
            }`}
          >
            {testState.phase === "testing"
              ? "测试中…"
              : testState.phase === "ok"
                ? "✓ 连接成功"
                : testState.phase === "fail"
                  ? "✗ 连接失败"
                  : "测试连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
