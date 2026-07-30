import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `免责声明 · ${BRAND.shortProductName}` };

const serif = {
  fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif',
  lineHeight: 1.8,
};

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-6 py-12 text-ink" style={serif}>
      <h1 className="text-2xl font-semibold">免责声明</h1>
      <p className="mt-2 text-sm text-ink-faint">最后更新：2026年5月</p>

      <div className="mt-8 space-y-8 text-[15px] text-ink-soft">
        <section>
          <h2 className="text-lg font-semibold text-ink">AI 分析声明</h2>
          <p className="mt-2">
            {BRAND.productName} 平台提供的所有 AI
            生成内容（包括项目分析报告、决策辅助建议、知识库问答等）均由人工智能自动生成，仅供参考。上述内容不构成任何形式的投资建议、法律意见或财务建议。用户应结合自身专业判断使用，本平台对用户基于上述内容作出的任何决策不承担责任。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">数据安全声明</h2>
          <p className="mt-2">
            本平台采用行业标准加密技术保护用户数据。用户上传的文件存储于加密云存储，API
            Key 采用 AES-256-GCM
            加密存储。尽管如此，互联网环境存在固有风险，用户应避免上传极度敏感的文件。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">第三方服务声明</h2>
          <p className="mt-2">
            本平台通过用户自带 API Key 调用第三方 AI 服务（DeepSeek、OpenAI、通义千问、Claude
            等）。上述服务由对应服务商提供，本平台不对第三方服务的可用性、准确性及费用承担责任。
          </p>
        </section>
      </div>
      </div>
    </div>
  );
}
