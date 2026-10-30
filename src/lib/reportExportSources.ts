import type { DeepResearchExternalResult } from "@/lib/deepResearchExternal";

export interface ReportExportSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  domain: string;
  publishedAt: string | null;
  sourceTier: string;
  evidenceStatus: string;
  findingIds?: string[];
  topics?: string[];
  claims?: string[];
}

export function reportExportSources(
  external: DeepResearchExternalResult | null | undefined
): ReportExportSource[] {
  const seen = new Set<string>();
  const findingsByUrl = new Map<string, DeepResearchExternalResult["findings"]>();
  for (const finding of external?.findings ?? []) {
    for (const url of finding.sourceUrls ?? []) {
      const current = findingsByUrl.get(url) ?? [];
      current.push(finding);
      findingsByUrl.set(url, current);
    }
  }
  return (external?.sources ?? []).flatMap((source, index) => {
    const url = String(source.url ?? "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    const findings = findingsByUrl.get(url) ?? [];
    return [{
      id: String(source.id || `E-S${index + 1}`).trim(),
      title: String(source.title || url).trim(),
      url,
      publisher: String(source.publisher || source.domain || "外部来源").trim(),
      domain: String(source.domain || "").trim(),
      publishedAt: source.publishedAt || null,
      sourceTier: String(source.sourceTier || "").trim(),
      evidenceStatus: String(source.evidenceStatus || "").trim(),
      findingIds: [...new Set(findings.map((finding) => finding.id).filter(Boolean))],
      topics: [...new Set(findings.map((finding) => finding.topic).filter(Boolean))],
      claims: [...new Set(findings.map((finding) => finding.claim).filter(Boolean))],
    }];
  }).slice(0, 40);
}

export function reportExportSourceNotes(sources: ReportExportSource[]): string {
  if (!sources.length) return "";
  return [
    "外部来源（审核稿溯源）",
    ...sources.map((source) => {
      const date = source.publishedAt || "日期未确认";
      return `${source.id}｜${source.publisher}｜${source.title}｜${date}｜${source.url}`;
    }),
  ].join("\n");
}
