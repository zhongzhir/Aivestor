import { ProfileForm } from "@/components/settings/ProfileForm";

export const dynamic = "force-dynamic";

export default function PreferenceSettingsPage() {
  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">投资偏好</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        维护行业、阶段、票额、判断风格和排除项。系统在生成报告、对话追问和决策辅助时会参考这些偏好。
      </p>
      <div className="mt-6">
        <ProfileForm />
      </div>
    </section>
  );
}
