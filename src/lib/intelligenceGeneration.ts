import { loadUserAICredentials, type UserCredentials } from "@/lib/report";
import { reserveQuota } from "@/lib/freeQuota";
import { INTELLIGENCE_GENERATION_ESTIMATED_TOKENS } from "@/lib/intelligenceConfig";

export interface GenerationAccess {
  credentials: UserCredentials;
  source: "custom" | "platform";
}

export async function getGenerationAccess(userId: string): Promise<GenerationAccess | null> {
  const credentials = await loadUserAICredentials(userId);
  if (!credentials) return null;
  return { credentials, source: credentials.usingFreeQuota ? "platform" : "custom" };
}

export async function reserveIntelligenceQuota(userId: string): Promise<boolean> {
  return reserveQuota(userId, INTELLIGENCE_GENERATION_ESTIMATED_TOKENS, "intelligence-brief");
}
