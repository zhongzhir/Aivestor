import { BRAND } from "@/lib/brand";

export function GET() {
  return Response.json({
    name: BRAND.productName,
    short_name: BRAND.shortProductName,
    description: `面向投资团队的${BRAND.shortProductName}工作台`,
    start_url: "/",
    display: "standalone",
    background_color: BRAND.colors.surface,
    theme_color: BRAND.colors.deep,
    lang: "zh-CN",
    icons: [
      { src: BRAND.assets.appIcon, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: BRAND.assets.appIconMaskable, sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  });
}
