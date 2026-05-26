import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiKeyConfig } from "@/components/project/ApiKeyConfig";
import { ApiKeyGuide } from "@/components/project/ApiKeyGuide";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { RecommendedPlans } from "@/components/settings/RecommendedPlans";
import { DataExport } from "@/components/settings/DataExport";

export const dynamic = "force-dynamic";

// 个人设置：投资人画像置顶 + AI 模型配置。
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
      <h1 className="text-xl font-semibold text-ink">个人设置</h1>

      {/* 区块一：投资人画像（置顶） */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-ink">投资人画像</h2>
        <p className="mt-2 text-xs leading-6 text-ink-faint">
          填写你的投资偏好与判断风格，Aivestor 在生成报告、对话追问、决策辅助时
          会优先参考这份画像，让 AI 更懂你。
        </p>
        <div className="mt-6">
          <ProfileForm />
        </div>
      </section>

      {/* 区块二：数据导出与迁移 */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-sm font-medium text-ink">数据导出与迁移</h2>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          把你在 Aivestor 沉淀的投资画像、知识库与项目判断导出带走。
          你的判断，永远属于你。
        </p>
        <div className="mt-6">
          <DataExport />
        </div>
      </section>

      {/* 区块三：AI 模型配置 */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-sm font-medium text-ink">AI 模型配置</h2>
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          配置你的 AI 服务商和 API Key。
          Key 经 AES-256-GCM 加密后存储于数据库，页面仅显示脱敏值，
          调用大模型时由服务端解密使用。
        </p>
        <div className="mt-4">
          <RecommendedPlans defaultExpanded={!hasApiKey} />
          <ApiKeyConfig />
        </div>

        <ApiKeyGuide />
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
