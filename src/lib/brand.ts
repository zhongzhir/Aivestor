export type BrandProfile = "aivestor" | "zhongjian-zhitou";

export interface BrandConfig {
  profile: BrandProfile;
  name: string;
  englishName: string;
  productName: string;
  shortProductName: string;
  legalName: string;
  website: string;
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
  };
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://aivestor.cn";

export const BRAND_CONFIGS: Record<BrandProfile, BrandConfig> = {
  aivestor: {
    profile: "aivestor",
    name: "Aivestor",
    englishName: "AIVESTOR",
    productName: "Aivestor 投资工作台",
    shortProductName: "Aivestor",
    legalName: "Aivestor",
    website: appUrl,
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
    },
  },
  "zhongjian-zhitou": {
    profile: "zhongjian-zhitou",
    name: "中鉴智投",
    englishName: "ZHONGJIAN INTELLIGENT INVESTMENT",
    productName: "中鉴智投AI投资工作台",
    shortProductName: "中鉴智投",
    legalName: "中鉴智投（杭州）智能科技有限公司",
    website: process.env.NEXT_PUBLIC_APP_URL || "https://aivestor.com.cn",
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
    },
  },
};

export function getBrandConfig(profile?: string | null): BrandConfig {
  const key = profile || process.env.NEXT_PUBLIC_BRAND_PROFILE || "aivestor";
  return BRAND_CONFIGS[key as BrandProfile] ?? BRAND_CONFIGS.aivestor;
}

export const BRAND = getBrandConfig();
