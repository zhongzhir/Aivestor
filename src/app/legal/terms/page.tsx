import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `用户服务协议 · ${BRAND.shortProductName}` };

const serif = {
  fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif',
  lineHeight: 1.8,
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-6 py-12 text-ink" style={serif}>
      <h1 className="text-2xl font-semibold">{BRAND.productName} 用户服务协议</h1>
      <p className="mt-2 text-sm text-ink-faint">最后更新：2026年5月</p>

      <div className="mt-8 space-y-8 text-[15px] text-ink-soft">
        <section>
          <h2 className="text-lg font-semibold text-ink">1. 服务说明</h2>
          <p className="mt-2">
            {BRAND.productName} 是面向股权投资专业人员的 AI
            增强型工作台，提供项目分析、知识库管理、投资决策辅助等功能。本平台的 AI
            分析结果仅供参考，不构成投资建议，不代替专业判断。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">2. 用户责任</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>你对上传至本平台的所有文件和数据拥有合法权利，或已获得相关授权</li>
            <li>你应妥善保管账号和密码，对账号下的所有操作负责</li>
            <li>禁止将本平台用于任何违法违规用途</li>
            <li>禁止上传涉及国家机密、商业秘密（未经授权）的文件</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">3. 数据与隐私</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>你上传的文件和数据归你所有，本平台不用于任何商业目的</li>
            <li>本平台使用加密技术保护你的 API Key 和敏感信息</li>
            <li>本平台不会将你的数据出售或共享给第三方</li>
            <li>你可以随时删除账号及所有数据</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">4. AI 免责声明</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              本平台的 AI 分析基于你提供的材料生成，结果的准确性取决于输入材料的质量
            </li>
            <li>AI 分析结果不构成投资建议，投资决策风险由用户自行承担</li>
            <li>本平台不对因使用 AI 分析结果导致的任何投资损失承担责任</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">5. 服务变更与终止</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>本平台保留随时调整、暂停或终止服务的权利，会提前通知用户</li>
            <li>如需注销账号，请在设置页面操作，注销后数据不可恢复</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">6. 适用法律</h2>
          <p className="mt-2">
            本协议适用中华人民共和国法律。如发生争议，双方协商解决。
          </p>
        </section>
      </div>
      </div>
    </div>
  );
}
