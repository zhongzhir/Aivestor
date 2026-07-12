import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiKeyConfig } from "@/components/project/ApiKeyConfig";
import { ApiKeyGuide } from "@/components/project/ApiKeyGuide";
import { RecommendedPlans } from "@/components/settings/RecommendedPlans";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
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
    <section className="rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">AI 与模型</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        配置 AI 服务商和 API Key。Key 经 AES-256-GCM 加密后存储于数据库，页面仅显示脱敏值。
      </p>
      <div className="mt-5">
        <RecommendedPlans defaultExpanded={!hasApiKey} />
        <ApiKeyConfig />
      </div>
      <ApiKeyGuide />
    </section>
  );
}
