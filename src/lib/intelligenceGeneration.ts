import { loadUserAICredentials, type UserCredentials } from "@/lib/report";
import { reserveQuota } from "@/lib/freeQuota";
import { INTELLIGENCE_GENERATION_ESTIMATED_TOKENS } from "@/lib/intelligenceConfig";
import { query } from "@/lib/db";

export interface GenerationAccess {
  credentials: UserCredentials;
  source: "custom" | "platform";
}

export async function getGenerationAccess(userId: string): Promise<GenerationAccess | null> {
  const configured = await query<{ api_key_encrypted: string | null }>(
    "SELECT api_key_encrypted FROM users WHERE id = $1",
    [userId]
  ).catch(() => []);
  const credentials = await loadUserAICredentials(userId);
  if (!credentials) return null;
  // 用户明确配置过 BYOK 时，解密或读取失败不得静默回退平台额度。
  if (configured[0]?.api_key_encrypted && credentials.usingFreeQuota) return null;
  return { credentials, source: credentials.usingFreeQuota ? "platform" : "custom" };
}

export async function reserveIntelligenceQuota(userId: string): Promise<boolean> {
  return reserveQuota(userId, INTELLIGENCE_GENERATION_ESTIMATED_TOKENS, "intelligence-brief");
}
