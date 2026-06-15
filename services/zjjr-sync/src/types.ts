// 同步服务内部领域类型（独立于主应用类型，不 import src/ 层代码）。

// ---- 清洗后的结构化记录（pipeline/clean.ts 产物）----
export interface CleanInstitution {
  sourceId: string;
  name: string;
  canonicalName: string;
  institutionType: string | null;
  fundCount: number | null;
  manageScale: string | null;
  focusSectors: string[];
  focusStages: string[];
  region: string | null;
  regStatus: string | null;
  raw: Record<string, unknown>;
  sourceUpdatedAt: string | null;
}

export interface CleanInvestment {
  sourceId: string;
  institutionSourceId: string;
  targetCompany: string;
  sector: string | null;
  stage: string | null;
  amountText: string | null;
  investedAt: string | null; // YYYY-MM-DD 或 null（解析失败入 raw 不丢弃）
  coInvestors: string[];
  raw: Record<string, unknown>;
  sourceUpdatedAt: string | null;
}

// ---- 实体解析（resolve.ts）后，机构带上数据库内的 id 与合并状态 ----
export interface ResolvedInstitution extends CleanInstitution {
  id: string; // upsert 后的 zjjr_institutions.id
  aliases: string[];
  pendingMerge: { candidateId: string; similarity: number }[]; // 写入 metadata，不自动合并
}

// ---- 特征提取（extract.ts）产物（向量化前）----
export type FeatureKind =
  | "institution_profile"
  | "sector_trend"
  | "investment_preference"
  | "activity_summary";

export interface ExtractedFeature {
  featureKind: FeatureKind;
  institutionId: string | null;
  sector: string | null;
  title: string;
  // narrate.ts 填入自然语言正文；extract.ts 仅给出统计结构
  stats: Record<string, unknown>;
  dataAsOf: string; // YYYY-MM-DD
}

// ---- 自然语言化（narrate.ts）后，特征带上正文与有效期 ----
export interface NarratedFeature extends ExtractedFeature {
  content: string;
  validUntil: string; // YYYY-MM-DD
}

// ---- 向量化（embed.ts）后 ----
export interface EmbeddedFeature extends NarratedFeature {
  embedding: number[] | null; // 未配置 BAILIAN_API_KEY 时为 null（降级，仍可全文检索）
}
