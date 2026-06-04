// 核心领域类型，与 db/schema.sql 对应

export type Plan = "personal" | "pro" | "team";
export type AIProvider = "deepseek" | "claude" | "qwen";

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  preferredProvider: AIProvider;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = "evaluating" | "invested" | "passed" | "exited";

export interface Project {
  id: string;
  userId: string;
  name: string;
  companyName: string | null;
  industry: string | null;
  stage: string | null;
  status: ProjectStatus;
  judgmentPoints: string[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FileType = "pdf" | "docx" | "xlsx" | "image";
export type DocKind =
  | "bp"
  | "research"
  | "contract"
  | "financial_model"
  | "news"
  | "other";
export type ParseStatus = "pending" | "processing" | "done" | "failed";

export interface Document {
  id: string;
  userId: string;
  projectId: string | null;
  filename: string;
  fileType: FileType;
  fileUrl: string | null;
  fileSize: number | null;
  docKind: DocKind;
  extractedText: string | null;
  tags: string[];
  parseStatus: ParseStatus;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeEntryType =
  | "industry"
  | "project"
  | "thesis"
  | "prediction"
  | "chunk";

export interface KnowledgeBaseEntry {
  id: string;
  userId: string;
  sourceDocumentId: string | null;
  projectId: string | null;
  entryType: KnowledgeEntryType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// AI / Excel 提取的结构化财务数据
export type FinPointType = "actual" | "forecast";
export type FinConfidence = "high" | "low";

// 单个时间序列数据点（收入、利润、利润率等）
export interface FinPoint {
  year: number;
  value: number;
  type: FinPointType;
  confidence: FinConfidence;
}

// 关键指标（自由文本型）
export interface FinKeyMetric {
  label: string;
  value: string;
  year: number | null;
  confidence: FinConfidence;
  note: string;
}

export interface FinValuation {
  round?: string;
  year?: number | null;
  value: number | string;
  unit?: string;
  confidence?: FinConfidence;
}

export interface FinancialData {
  currency: string;
  unit: string;
  extraction_quality: "high" | "medium" | "low";
  extraction_note: string;
  revenue: FinPoint[];
  ebitda: FinPoint[];
  ebit: FinPoint[];
  net_income: FinPoint[];
  gross_margin: FinPoint[];
  net_margin: FinPoint[];
  headcount: FinPoint[];
  customers: FinPoint[];
  arr: FinPoint[];
  mrr: FinPoint[];
  // #24 新增：现金流与跑道
  cash: FinPoint[];                    // 现金及现金等价物
  burn_rate: FinPoint[];               // 月均净消耗（负数表示烧钱）
  runway_months: FinKeyMetric[];       // 现金跑道（月数），用 FinKeyMetric 承载非标数值
  valuation: FinValuation[];
  key_metrics: FinKeyMetric[];
}

export interface Report {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  content: string;
  version: number;
  status: "draft" | "finalized";
  createdAt: string;
  updatedAt: string;
}
