export const SECURITY_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export function isSessionWithinMaxAge(
  startedAtSeconds: number,
  nowSeconds: number
): boolean {
  return nowSeconds - startedAtSeconds <= SECURITY_SESSION_MAX_AGE_SECONDS;
}

export function confirmSensitiveAction(message: string): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}
