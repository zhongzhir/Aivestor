import type {
  FormalReportProfile,
  FormalReportProfileKey,
} from "@/lib/formal-report/types";

const BASE_THEME = {
  accent: "D46A32",
  accentDark: "0D1B3E",
  accentSoft: "F6EEE9",
};

export const FORMAL_REPORT_PROFILES: Record<
  FormalReportProfileKey,
  FormalReportProfile
> = {
  project_initiation: {
    key: "project_initiation",
    label: "立项报告",
    subtitle: "项目立项审议材料",
    confidentiality: "内部机密 · 仅供立项审议",
    ...BASE_THEME,
  },
  investment_committee: {
    key: "investment_committee",
    label: "投决会报告",
    subtitle: "投资决策委员会审议材料",
    confidentiality: "严格保密 · 仅供投委会审议",
    ...BASE_THEME,
  },
  lp: {
    key: "lp",
    label: "LP 报告",
    subtitle: "有限合伙人定期报告",
    confidentiality: "保密 · 仅供有限合伙人参阅",
    ...BASE_THEME,
  },
  post_investment: {
    key: "post_investment",
    label: "投后管理报告",
    subtitle: "投后经营与风险跟踪材料",
    confidentiality: "内部资料 · 未经许可不得外传",
    ...BASE_THEME,
  },
  association: {
    key: "association",
    label: "协会报送材料",
    subtitle: "行业协会报送底稿",
    confidentiality: "报送底稿 · 正式报送前须复核",
    ...BASE_THEME,
  },
  general: {
    key: "general",
    label: "正式分析报告",
    subtitle: "专业投资研究材料",
    confidentiality: "内部资料 · 未经许可不得外传",
    ...BASE_THEME,
  },
};

export function isFormalReportProfileKey(
  value: string | null
): value is FormalReportProfileKey {
  return !!value && value in FORMAL_REPORT_PROFILES;
}

export function inferFormalReportProfile(
  kind: string | null | undefined,
  requested?: string | null
): FormalReportProfile {
  if (requested && isFormalReportProfileKey(requested)) {
    return FORMAL_REPORT_PROFILES[requested];
  }

  const key: FormalReportProfileKey =
    kind === "committee"
      ? "investment_committee"
      : kind === "lp_report"
        ? "lp"
        : kind === "post_investment"
          ? "post_investment"
          : kind === "analysis"
            ? "project_initiation"
            : "general";
  return FORMAL_REPORT_PROFILES[key];
}
