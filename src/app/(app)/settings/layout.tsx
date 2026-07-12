import { PendingInvites } from "@/components/org/PendingInvites";
import { SettingsNav } from "./SettingsNav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PendingInvites />

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Settings
        </p>
        <h1 className="mt-2 text-xl font-semibold text-ink">设置</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">
          投资偏好用于影响分析口径；账户、安全、模型和数据管理分别放在独立页面中维护。
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
