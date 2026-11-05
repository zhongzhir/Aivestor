export interface IntelligenceCursor {
  createdAt: string;
  id: string;
}

export function encodeIntelligenceCursor(value: IntelligenceCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeIntelligenceCursor(value: string | null): IntelligenceCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<IntelligenceCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !Number.isFinite(new Date(parsed.createdAt).getTime())) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
