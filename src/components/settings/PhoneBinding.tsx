"use client";

import { useEffect, useState } from "react";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 已登录邮箱账号补绑手机号（F-15 方向A）：绑定后解锁完整免费额度。
export function PhoneBinding() {
  const [loading, setLoading] = useState(true);
  const [bound, setBound] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0); // 发送验证码冷却秒数
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const res = await fetch("/api/user/bind-phone");
      if (!res.ok) return;
      const data = await res.json();
      setBound(!!data.bound);
      setPhoneMasked(data.phoneMasked ?? null);
    } catch {
      // 静默忽略
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const phoneValid = /^1\d{10}$/.test(phone.trim());

  async function sendCode() {
    setError("");
    setMessage("");
    if (!phoneValid) {
      setError("请输入正确的手机号");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ phone: phone.trim(), purpose: "bind" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "验证码发送失败");
        return;
      }
      setMessage("验证码已发送，5 分钟内有效");
      setCooldown(60);
    } catch {
      setError("验证码发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  }

  async function bind() {
    setError("");
    setMessage("");
    if (!phoneValid || !code.trim()) {
      setError("请输入手机号与验证码");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/user/bind-phone", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "绑定失败");
        return;
      }
      setBound(true);
      setPhoneMasked(data.phoneMasked ?? null);
      setMessage("绑定成功，免费额度已提升");
    } catch {
      setError("绑定失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-ink-faint">加载中…</p>;
  }

  if (bound) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-ink">
          已绑定手机号
          <span className="ml-2 font-medium">{phoneMasked ?? "已绑定"}</span>
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          手机号用于账号安全与免费额度发放，不会对外展示。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-ink">绑定手机号可解锁额外 50 万 tokens 免费额度。</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="tel"
          inputMode="numeric"
          placeholder="手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-44"
        />
        <button
          type="button"
          onClick={sendCode}
          disabled={sending || cooldown > 0 || !phoneValid}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-ink-soft hover:bg-slate-50 disabled:opacity-50"
        >
          {cooldown > 0 ? `${cooldown}s 后重发` : sending ? "发送中…" : "发送验证码"}
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          inputMode="numeric"
          placeholder="验证码"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-44"
        />
        <button
          type="button"
          onClick={bind}
          disabled={submitting || !phoneValid || !code.trim()}
          className="rounded-lg bg-[#1B6FE8] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "绑定中…" : "绑定"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-[#3d7a5e]">{message}</p>}
      {error && <p className="mt-2 text-xs text-[#FF6B35]">{error}</p>}
    </div>
  );
}
