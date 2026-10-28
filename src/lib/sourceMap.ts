export type SourceLocatorType = "page" | "slide" | "sheet_range" | "paragraph_range" | "ocr_page" | "image_region";

export interface SourceMapEntry {
  locator: string;
  locatorType: SourceLocatorType;
  label: string;
  text: string;
  page?: number;
  slide?: number;
  sheet?: string;
  range?: string;
  paragraphStart?: number;
  paragraphEnd?: number;
}

export function normalizeSourceMap(value: unknown): SourceMapEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.locator !== "string" ||
      typeof row.locatorType !== "string" ||
      typeof row.label !== "string" ||
      typeof row.text !== "string"
    ) {
      return [];
    }
    return [row as unknown as SourceMapEntry];
  });
}

export function sourceMapText(entries: SourceMapEntry[]): string {
  return entries
    .filter((entry) => entry.text.trim())
    .map((entry) => `[定位:${entry.locator}] ${entry.label}\n${entry.text.trim()}`)
    .join("\n\n");
}
