import { PhoneBinding } from "@/components/settings/PhoneBinding";

export const dynamic = "force-dynamic";

export default function AccountSettingsPage() {
  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">账户与安全</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        管理登录身份、手机号绑定和账号安全相关信息。这里不影响投资判断口径。
      </p>
      <div id="phone-binding" className="mt-6 scroll-mt-20">
        <PhoneBinding />
      </div>
    </section>
  );
}
