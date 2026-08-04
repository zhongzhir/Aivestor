"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

interface Props {
  // 由父组件决定是否渲染（基于 DB 中 onboarding_completed 标记）
  onClose: () => void;
}

type Step = 1 | 2;

const FEATURES = [
  {
    icon: "📄",
    title: "上传 BP",
    desc: "秒级生成专业分析报告",
  },
  {
    icon: "🧠",
    title: "知识库",
    desc: "沉淀你的每一个投资判断",
  },
  {
    icon: "⚡",
    title: "AI 对话",
    desc: "随时探讨项目与投资逻辑",
  },
];

export function OnboardingDialog({ onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [closing, setClosing] = useState(false);

  async function persistAndClose() {
    if (closing) return;
    setClosing(true);
    try {
      await fetch("/api/user/onboarding-complete", { method: "POST" });
    } catch {
      // 静默：弹窗本次会话已关闭即可
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={persistAndClose}
    >
      <div
        className="card-base w-full max-w-lg p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step 指示器 */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                step === 1
                  ? "bg-[#1B6FE8] text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              1
            </span>
            <span className="h-px w-8 bg-slate-200" />
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                step === 2
                  ? "bg-[#1B6FE8] text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              2
            </span>
            <span className="ml-2">{step} / 2</span>
          </div>
          <button
            type="button"
            onClick={persistAndClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {step === 1 ? <StepOne onNext={() => setStep(2)} /> : null}
        {step === 2 ? <StepTwo onSkip={persistAndClose} /> : null}
      </div>
    </div>
  );
}

function StepOne({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h2 className="text-xl font-semibold tracking-tight text-slate-800">
        欢迎使用 {BRAND.productName}
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        以投资人为中心，AI 赋能投资人持续进化
      </p>

      <div className="mt-6 space-y-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3"
          >
            <span className="text-2xl leading-none">{f.icon}</span>
            <div>
              <p className="text-sm font-medium text-slate-800">{f.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        <Link
          href="/demo/consumer"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-soft transition-colors duration-150 hover:bg-slate-50"
        >
          查看示例项目
        </Link>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-[#1B6FE8] px-4 py-2 text-sm font-medium tracking-[0.01em] text-white transition-colors duration-150 hover:bg-[#1762d0]"
        >
          开始使用 →
        </button>
      </div>
    </>
  );
}

function StepTwo({ onSkip }: { onSkip: () => void }) {
  return (
    <>
      <h2 className="text-xl font-semibold tracking-tight text-slate-800">
        完善你的投资人画像
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        填写后，AI 将基于你的风格生成更精准的分析。（可跳过）
      </p>

      <div className="mt-6 space-y-3">
        <Link
          href="/settings/preference"
          onClick={onSkip}
          className="card-hover flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">个人画像</p>
            <p className="mt-0.5 text-xs text-slate-500">
              描述你的投资阶段、赛道、风格
            </p>
          </div>
          <span className="text-sm font-medium text-blue-700">去填写 →</span>
        </Link>

        <Link
          href="/settings/ai"
          onClick={onSkip}
          className="card-hover flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">API Key</p>
            <p className="mt-0.5 text-xs text-slate-500">
              配置后即可使用 AI 功能
            </p>
          </div>
          <span className="text-sm font-medium text-blue-700">去配置 →</span>
        </Link>
      </div>

      <div className="mt-7 flex justify-end">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-soft transition-colors duration-150 hover:bg-slate-50"
        >
          跳过，稍后再说
        </button>
      </div>
    </>
  );
}
