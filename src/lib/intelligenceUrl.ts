export function safeIntelligenceExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  // PostgreSQL btree entries have a finite row budget. Keep canonical URLs below
  // the evidence composite-index safety envelope instead of failing the whole run.
  if (value.trim().length > 1800) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    const canonical = url.toString();
    return canonical.length <= 1800 ? canonical : null;
  } catch {
    return null;
  }
}
