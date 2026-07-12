import Link from "next/link";
import { DataExport } from "@/components/settings/DataExport";

export const dynamic = "force-dynamic";

export default function DataSettingsPage() {
  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">数据与协议</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        导出你在 Aivestor 沉淀的投资偏好、知识库与项目判断。项目材料和判断记录仍归属于你或所属组织。
      </p>
      <div className="mt-6">
        <DataExport />
      </div>
      <footer className="mt-8 border-t border-line pt-6 text-xs text-ink-faint">
        使用即表示同意{" "}
        <Link href="/legal/terms" className="hover:underline">
          用户协议
        </Link>{" "}
        ·{" "}
        <Link href="/legal/disclaimer" className="hover:underline">
          免责声明
        </Link>
      </footer>
    </section>
  );
}
