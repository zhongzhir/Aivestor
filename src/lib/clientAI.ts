// 客户端流式读取与跨页数据传递工具。
// AI API Key 已改为服务端加密存储，不再经客户端透传。

// 从一个非 2xx 响应里提取可读错误信息。
// 兼容三种情况：① JSON {error}；② 平台网关的纯文本/HTML（如 504
// "An error occurred..."）；③ 读取失败。避免对纯文本做 res.json() 而抛
// "Unexpected token 'A'..." 这类看不懂的报错。
export async function readError(
  res: Response,
  fallback = "请求失败"
): Promise<string> {
  if (res.status === 504 || res.status === 408) {
    return "请求超时：AI 服务响应过慢或无响应，请稍后重试";
  }
  if (res.status === 503) {
    return "AI 服务暂时不可用，请稍后重试";
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    return `${fallback}（${res.status}）`;
  }
  if (text) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data.error === "string" && data.error) {
        return data.error;
      }
    } catch {
      // 非 JSON：不把整段 HTML/文本抛给用户，只给简短提示
    }
  }
  return `${fallback}（${res.status}）`;
}

// 读取流式响应，逐块回调文本增量
export async function readTextStream(
  res: Response,
  onChunk: (text: string) => void
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

// 用于在项目页与报告页之间传递本轮判断要点
export function stashJudgmentPoints(projectId: string, points: string[]) {
  sessionStorage.setItem(`iw_gen_${projectId}`, JSON.stringify(points));
}

export function popJudgmentPoints(projectId: string): string[] | null {
  const raw = sessionStorage.getItem(`iw_gen_${projectId}`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
