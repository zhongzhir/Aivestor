// 认证页顶部品牌区。
import Image from "next/image";
import { BRAND } from "@/lib/brand";

export function AuthBrand({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <Image src={BRAND.assets.logo} alt={BRAND.productName} width={220} height={64} className="mx-auto h-14 w-auto max-w-[220px] object-contain" priority />
      <p className="mt-1.5 text-sm text-ink-faint">{subtitle}</p>
    </div>
  );
}
