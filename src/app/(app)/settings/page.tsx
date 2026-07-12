import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiKeyConfig } from "@/components/project/ApiKeyConfig";
import { ApiKeyGuide } from "@/components/project/ApiKeyGuide";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { PendingInvites } from "@/components/org/PendingInvites";
import { RecommendedPlans } from "@/components/settings/RecommendedPlans";
import { DataExport } from "@/components/settings/DataExport";
import { PhoneBinding } from "@/components/settings/PhoneBinding";

export const dynamic = "force-dynamic";

// 设置：投资偏好、账户安全、AI 模型和数据管理分区展示。
export default async function SettingsPage() {
  // 是否已有 API Key：决定推荐方案区块默认展开/折叠
  const session = await requireAuth();
  let hasApiKey = false;
  try {
    const rows = await query<{ api_key_encrypted: string | null }>(
      "SELECT api_key_encrypted FROM users WHERE id = $1",
      [session.user.id]
    );
    hasApiKey = !!rows[0]?.api_key_encrypted;
  } catch {
    hasApiKey = false;
  }

  return (
    <div className="mx-auto max-w-doc px-6 py-12">
      {/* 待处理的组织邀请（无邀请时不渲染） */}
      <PendingInvites />

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Settings
        </p>
        <h1 className="mt-2 text-xl font-semibold text-ink">设置</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          分开管理投资偏好、账户安全、AI 模型和数据归属。投资偏好影响分析口径，系统设置只处理账号与服务连接。
        </p>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 text-xs">
        <SettingsAnchor href="#investment-preference" label="投资偏好" />
        <SettingsAnchor href="#account-security" label="账户与安全" />
        <SettingsAnchor href="#ai-model" label="AI 与模型" />
        <SettingsAnchor href="#data-ownership" label="数据与协议" />
      </nav>

      {/* 区块一：投资偏好 */}
      <section id="investment-preference" className="mt-8 scroll-mt-20 rounded-lg border border-line bg-white p-6">
        <h2 className="text-sm font-medium text-ink">投资偏好</h2>
        <p className="mt-2 text-xs leading-6 text-ink-faint">
          这里维护行业、阶段、票额、判断风格和排除项。Aivestor 在生成报告、对话追问和决策辅助时会参考这些偏好。
        </p>
        <div className="mt-6">
          <ProfileForm />
        </div>
      </section>

      {/* 区块二：账户与安全 */}
      <section id="account-security" className="mt-8 scroll-mt-20 rounded-lg border border-line bg-white p-6">
        <h2 className="text-sm font-medium text-ink">账户与安全</h2>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          管理登录身份、手机号绑定和账号安全相关信息。这里不影响投资判断口径。
        </p>
        <div className="mt-6">
          <PhoneBinding />
        </div>
      </section>

      {/* 区块三：AI 与模型 */}
      <section id="ai-model" className="mt-8 scroll-mt-20 rounded-lg border border-line bg-white p-6">
        <h2 className="text-sm font-medium text-ink">AI 与模型</h2>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          配置 AI 服务商和 API Key。
          Key 经 AES-256-GCM 加密后存储于数据库，页面仅显示脱敏值，
          调用大模型时由服务端解密使用。
        </p>
        <div className="mt-4">
          <RecommendedPlans defaultExpanded={!hasApiKey} />
          <ApiKeyConfig />
        </div>

        <ApiKeyGuide />
      </section>

      {/* 区块四：数据与协议 */}
      <section id="data-ownership" className="mt-8 scroll-mt-20 rounded-lg border border-line bg-white p-6">
        <h2 className="text-sm font-medium text-ink">数据与协议</h2>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          导出你在 Aivestor 沉淀的投资偏好、知识库与项目判断。项目材料和判断记录仍归属于你或所属组织。
        </p>
        <div className="mt-6">
          <DataExport />
        </div>
      </section>

      <footer className="mt-12 border-t border-line pt-6 text-xs text-ink-faint">
        使用即表示同意{" "}
        <Link href="/legal/terms" className="hover:underline">
          用户协议
        </Link>{" "}
        ·{" "}
        <Link href="/legal/disclaimer" className="hover:underline">
          免责声明
        </Link>
      </footer>
    </div>
  );
}

function SettingsAnchor({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="rounded-full border border-line bg-white px-3 py-1.5 text-ink-soft hover:border-accent hover:text-accent"
    >
      {label}
    </a>
  );
}
