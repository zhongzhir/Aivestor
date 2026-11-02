export const REPORT_CONTEXT_DOC_KINDS = [
  "bp",
  "research",
  "financial_model",
  "other",
] as const;

const REPORT_CONTEXT_DOC_KIND_SET = new Set<string>(REPORT_CONTEXT_DOC_KINDS);

export function isReportContextDocKind(value: unknown): boolean {
  return typeof value === "string" && REPORT_CONTEXT_DOC_KIND_SET.has(value);
}

export function hasReportContextText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isUsableReportContextDocument(document: {
  docKind?: unknown;
  doc_kind?: unknown;
  extractedText?: unknown;
  extracted_text?: unknown;
}): boolean {
  const docKind = document.docKind ?? document.doc_kind;
  const extractedText = document.extractedText ?? document.extracted_text;
  return isReportContextDocKind(docKind) && hasReportContextText(extractedText);
}

export function buildReportContextText(
  documents: Array<{
    docKind?: unknown;
    doc_kind?: unknown;
    extractedText?: unknown;
    extracted_text?: unknown;
  }>
): string {
  return documents
    .filter(isUsableReportContextDocument)
    .map((document) => String(document.extractedText ?? document.extracted_text).trim())
    .join("\n\n---\n\n");
}

export function isUsableReportContextMetadata(document: {
  docKind: unknown;
  parseStatus: unknown;
  chars: unknown;
}): boolean {
  return (
    isReportContextDocKind(document.docKind) &&
    document.parseStatus === "done" &&
    typeof document.chars === "number" &&
    Number.isFinite(document.chars) &&
    document.chars > 0
  );
}

export function hasUsableReportContextMetadata(
  documents: Array<{ docKind: unknown; parseStatus: unknown; chars: unknown }>
): boolean {
  return documents.some(isUsableReportContextMetadata);
}
