export function normalizePublicTimestamp(value?: string | null, reference = new Date()): string | null {
  if (!value || !String(value).trim()) return null;
  const parsed = new Date(String(value).trim());
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > reference.getUTCFullYear() + 1) return null;
  return parsed.toISOString();
}
