// src/lib/dataApps.ts —— 数据应用注册表（架构文档 v1.1 第 6.1 节）
//
// 注册制：新增应用 = 此数组加一条配置 + 在 src/components/data-apps/ 下新建组件，
//   框架（导航入口、路由解析、能力位守门、免责声明布局）零改动。
//
// 约定：应用如需服务端接口，统一挂 /api/data-apps/<app-id>/... 前缀，
//   路由内自行 requireCapabilityAPI（见 6.4）。

import type { ComponentType } from "react";

export interface DataAppConfig {
  id: string; // 路由段，对应 /data-apps/[appId]
  name: string; // 导航显示名
  icon: string; // emoji（与 SKILL_CATEGORIES 同风格）
  description: string;
  requiredCapability: string; // 守门能力位
  // 动态 import，按需加载（路径静态可分析，便于代码分割）
  component: () => Promise<{ default: ComponentType }>;
}

export const DATA_APPS: DataAppConfig[] = [
  {
    id: "market-insights",
    name: "市场洞察",
    icon: "📈",
    description: "基于中鉴基金研究院数据的定期市场动态汇总",
    requiredCapability: "zjjr_data",
    component: () => import("@/components/data-apps/MarketInsights"),
  },
  {
    id: "institution-lookup",
    name: "机构点查",
    icon: "🔎",
    description: "投资机构 / 投资人简要画像查询",
    requiredCapability: "zjjr_data",
    component: () => import("@/components/data-apps/InstitutionLookup"),
  },
  {
    id: "intelligence-subscriptions",
    name: "情报订制",
    icon: "🧭",
    description: "主动定义主题、范围与频率，生成并留存专属情报简报",
    requiredCapability: "zjjr_data",
    component: () => import("@/components/data-apps/IntelligenceSubscriptions"),
  },
];

export function getDataApp(id: string): DataAppConfig | undefined {
  return DATA_APPS.find((a) => a.id === id);
}
