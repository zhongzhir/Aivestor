export const AI_STREAM_ERROR_PREFIX = "[AIVESTOR_STREAM_ERROR]";

export function encodeAIStreamError(message: string): string {
  return `${AI_STREAM_ERROR_PREFIX}${JSON.stringify({ message })}`;
}

export function decodeAIStreamError(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message
      ? parsed.message
      : "AI 服务调用失败，请稍后重试。";
  } catch {
    return "AI 服务调用失败，请稍后重试。";
  }
}
