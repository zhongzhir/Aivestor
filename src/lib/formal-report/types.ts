export type FormalReportProfileKey =
  | "project_initiation"
  | "investment_committee"
  | "lp"
  | "post_investment"
  | "association"
  | "general";

export interface FormalReportProfile {
  key: FormalReportProfileKey;
  label: string;
  subtitle: string;
  confidentiality: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
}

export interface FormalReportMetadata {
  title: string;
  projectName?: string | null;
  organizationName?: string | null;
  industry?: string | null;
  stage?: string | null;
  reportDate: Date;
  version?: number | null;
}

export type FormalReportBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string; level: number }
  | { type: "number"; text: string; level: number }
  | { type: "quote"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "divider" };
