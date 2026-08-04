export type BrandProfile = "aivestor" | "zhongjian-zhitou";

export type BrandConfig = {
  profile: BrandProfile;
  name: string;
  englishName: string;
  productName: string;
  shortProductName: string;
  legalName: string;
  website: string;
  supportEmail: string;
  colors: {
    deep: string;
    primary: string;
    accent: string;
    surface: string;
  };
  assets: {
    logo: string;
    logoReverse: string;
    mark: string;
    appIcon: string;
    appIconMaskable: string;
    favicon: string;
    appleTouchIcon: string;
  };
};

const profile = (process.env.NEXT_PUBLIC_BRAND_PROFILE || "aivestor") as BrandProfile;
const isZhongjian = profile === "zhongjian-zhitou";
const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL || (isZhongjian ? "https://aivestor.com.cn" : "https://aivestor.cn");

export const BRAND_CONFIGS: Record<BrandProfile, BrandConfig> = {
  aivestor: {
    profile: "aivestor",
    name: "Aivestor",
    englishName: "AIVESTOR",
    productName: "Aivestor 投资工作台",
    shortProductName: "Aivestor",
    legalName: "Aivestor",
    website: publicAppUrl,
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Aivestor@qq.com",
    colors: {
      deep: "#0D1B3E",
      primary: "#1B6FE8",
      accent: "#FF6B35",
      surface: "#F4F7FB",
    },
    assets: {
      logo: "/icons/icon.svg",
      logoReverse: "/icons/icon.svg",
      mark: "/icons/icon.svg",
      appIcon: "/icons/icon.svg",
      appIconMaskable: "/icons/icon-maskable.svg",
      favicon: "/icons/icon.svg",
      appleTouchIcon: "/icons/icon.svg",
    },
  },
  "zhongjian-zhitou": {
    profile: "zhongjian-zhitou",
    name: "中鉴智投",
    englishName: "ZHONGJIAN INTELLIGENT INVESTMENT",
    productName: "中鉴智投AI投资工作台",
    shortProductName: "中鉴智投",
    legalName: "中鉴智投（杭州）智能科技有限公司",
    website: publicAppUrl,
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "",
    colors: {
      deep: "#0D1B3E",
      primary: "#1B6FE8",
      accent: "#FF6B35",
      surface: "#F4F7FB",
    },
    assets: {
      logo: "/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg",
      logoReverse: "/brand/zhongjian-zhitou/svg/logo-horizontal-reverse.svg",
      mark: "/brand/zhongjian-zhitou/svg/mark-color.svg",
      appIcon: "/brand/zhongjian-zhitou/svg/app-icon.svg",
      appIconMaskable: "/brand/zhongjian-zhitou/svg/app-icon-maskable.svg",
      favicon: "/brand/zhongjian-zhitou/ico/favicon.ico",
      appleTouchIcon: "/brand/zhongjian-zhitou/png/app-icon-180.png",
    },
  },
};

export function getBrandConfig(profileName?: string | null): BrandConfig {
  const requested = profileName || process.env.NEXT_PUBLIC_BRAND_PROFILE || "aivestor";
  return BRAND_CONFIGS[requested as BrandProfile] ?? BRAND_CONFIGS.aivestor;
}

export const BRAND = getBrandConfig(profile);

export const brandAsset = (path: string) => path;
