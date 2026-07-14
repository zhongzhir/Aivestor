export interface AIErrorContext {
  usingFreeQuota?: boolean;
}

type ErrorLike = {
  message?: unknown;
  status?: unknown;
  code?: unknown;
  error?: { code?: unknown; message?: unknown };
};

function errorDetails(error: unknown): {
  message: string;
  status: number | null;
  code: string;
} {
  const value = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const message =
    typeof value.message === "string"
      ? value.message
      : typeof value.error?.message === "string"
        ? value.error.message
        : "";
  const status =
    typeof value.status === "number"
      ? value.status
      : typeof value.status === "string" && /^\d+$/.test(value.status)
        ? Number(value.status)
        : null;
  const rawCode = value.code ?? value.error?.code;
  const code = typeof rawCode === "string" ? rawCode : "";
  return { message, status, code };
}

export function userFacingAIError(
  error: unknown,
  context: AIErrorContext = {}
): string {
  const { message, status, code } = errorDetails(error);
  const searchable = `${message} ${code}`.toLowerCase();
  const insufficientBalance =
    status === 402 ||
    searchable.includes("insufficient balance") ||
    searchable.includes("insufficient_balance") ||
    searchable.includes("insufficient quota") ||
    searchable.includes("billing");

  if (insufficientBalance) {
    return context.usingFreeQuota
      ? "平台 AI 服务余额不足，生成未完成。请稍后重试；如需立即继续，可在个人设置中配置自己的 API Key。"
      : "当前 AI 服务商账户余额或配额不足，生成未完成。请充值后重试，或在个人设置中更换 API Key。";
  }

  if (status === 401 || searchable.includes("invalid api key")) {
    return context.usingFreeQuota
      ? "平台 AI 服务凭证暂时不可用，请稍后重试。"
      : "当前 API Key 无效或已失效，请在个人设置中检查后重试。";
  }

  if (status === 429 || searchable.includes("rate limit")) {
    return "AI 服务当前请求较多，请稍后重试。";
  }

  if (searchable.includes("超时") || searchable.includes("timeout")) {
    return "AI 服务响应超时，请稍后重试。";
  }

  return "AI 服务调用失败，生成未完成，请稍后重试。";
}

export function aiErrorLogDetails(error: unknown): {
  message: string;
  status: number | null;
  code: string;
} {
  return errorDetails(error);
}
