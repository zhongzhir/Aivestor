import { isValidProvider, resolveAIModelSelection } from "@/lib/ai";
import { loadUserAICredentials, type UserCredentials } from "@/lib/report";
import {
  getFreeQuotaStatus,
  getSystemAIBaseURL,
  getSystemAIProvider,
  getSystemApiKey,
  reserveQuota,
} from "@/lib/freeQuota";
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

/**
 * 情报是平台提供的日常能力：有系统额度时始终优先使用平台配置，
 * 不让用户为了运行情报再选择或授权一次测试用 BYOK。平台不可用时，
 * 才回退到用户已保存的自有模型配置。
 */
export async function getIntelligenceGenerationAccess(userId: string): Promise<GenerationAccess | null> {
  const systemKey = getSystemApiKey();
  if (systemKey) {
    const quota = await getFreeQuotaStatus(userId);
    if (quota?.available) {
      const configured = getSystemAIProvider();
      const provider = isValidProvider(configured) ? configured : "deepseek";
      const selection = resolveAIModelSelection({ credentialProvider: provider, useSystemConfiguration: true });
      return {
        source: "platform",
        credentials: {
          provider: selection.provider,
          model: selection.model,
          apiKey: systemKey,
          baseURL: getSystemAIBaseURL(),
          usingFreeQuota: true,
          tokensRemaining: quota.tokensRemaining,
        },
      };
    }
  }
  return getGenerationAccess(userId);
}

export async function reserveIntelligenceQuota(userId: string): Promise<boolean> {
  return reserveQuota(userId, INTELLIGENCE_GENERATION_ESTIMATED_TOKENS, "intelligence-brief");
}
