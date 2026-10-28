// 客户端流式读取与跨页数据传递工具。
import {
  AI_STREAM_ERROR_PREFIX,
  decodeAIStreamError,
} from "@/lib/aiStreamProtocol";
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
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      pending += decoder.decode();
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const errorAt = pending.indexOf(AI_STREAM_ERROR_PREFIX);
    if (errorAt >= 0) {
      if (errorAt > 0) onChunk(pending.slice(0, errorAt));
      pending = pending.slice(errorAt);
      continue;
    }

    // 保留一小段尾部，避免错误标记恰好被网络分块拆开。
    const safeLength = pending.length - (AI_STREAM_ERROR_PREFIX.length - 1);
    if (safeLength > 0) {
      onChunk(pending.slice(0, safeLength));
      pending = pending.slice(safeLength);
    }
  }

  const errorAt = pending.indexOf(AI_STREAM_ERROR_PREFIX);
  if (errorAt >= 0) {
    if (errorAt > 0) onChunk(pending.slice(0, errorAt));
    throw new Error(
      decodeAIStreamError(
        pending.slice(errorAt + AI_STREAM_ERROR_PREFIX.length)
      )
    );
  }
  if (pending) onChunk(pending);
}

export interface ReportGenerationRequest {
  mode: "standard" | "deep_research";
  judgmentPoints: string[];
  profile?: "auto" | "early_stage" | "comprehensive";
  decisionContext?: string;
  sourceCutoffDate?: string;
}

// 用于在项目页与报告页之间传递一次报告生成任务。
export function stashReportGeneration(
  projectId: string,
  request: ReportGenerationRequest
) {
  sessionStorage.setItem(`iw_gen_${projectId}`, JSON.stringify(request));
}

export function popReportGeneration(
  projectId: string
): ReportGenerationRequest | null {
  const raw = sessionStorage.getItem(`iw_gen_${projectId}`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    // 兼容历史版本只保存 string[] 的会话数据。
    if (Array.isArray(v)) {
      return {
        mode: "standard",
        judgmentPoints: v.map(String),
      };
    }
    if (
      v &&
      (v.mode === "standard" || v.mode === "deep_research") &&
      Array.isArray(v.judgmentPoints)
    ) {
      return {
        mode: v.mode,
        judgmentPoints: v.judgmentPoints.map(String),
        profile:
          v.profile === "early_stage" ||
          v.profile === "comprehensive" ||
          v.profile === "auto"
            ? v.profile
            : undefined,
        decisionContext:
          typeof v.decisionContext === "string" ? v.decisionContext : undefined,
        sourceCutoffDate:
          typeof v.sourceCutoffDate === "string" ? v.sourceCutoffDate : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function stashJudgmentPoints(projectId: string, points: string[]) {
  stashReportGeneration(projectId, {
    mode: "standard",
    judgmentPoints: points,
  });
}

export function popJudgmentPoints(projectId: string): string[] | null {
  return popReportGeneration(projectId)?.judgmentPoints ?? null;
}
