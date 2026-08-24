import { query } from "@/lib/db";
import { streamChat } from "@/lib/ai";
import { freeQuotaMetaFor, loadUserAICredentials } from "@/lib/report";

export type ScreeningDisposition = "continue" | "more_info" | "not_priority";

export interface ScreeningEvidence {
  claim: string;
  quote: string;
}

export interface ScreeningResult {
  disposition: ScreeningDisposition;
  summary: string;
  strengths: string[];
  risks: string[];
  missing_information: string[];
  criteria_fit: string | null;
  evidence: ScreeningEvidence[];
  confidence: "high" | "medium" | "low";
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 6)
    : [];
}

export function parseScreeningResult(raw: string): ScreeningResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const value = JSON.parse(candidate) as Record<string, unknown>;
  const disposition = value.disposition;
  if (!new Set(["continue", "more_info", "not_priority"]).has(String(disposition))) {
    throw new Error("AI 未返回有效初筛结论");
  }
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return typeof row.claim === "string" && typeof row.quote === "string"
          ? [{ claim: row.claim.trim(), quote: row.quote.trim().slice(0, 500) }]
          : [];
      }).slice(0, 8)
    : [];
  return {
    disposition: disposition as ScreeningDisposition,
    summary: typeof value.summary === "string" ? value.summary.trim() : "",
    strengths: textArray(value.strengths),
    risks: textArray(value.risks),
    missing_information: textArray(value.missing_information),
    criteria_fit: typeof value.criteria_fit === "string" && value.criteria_fit.trim() ? value.criteria_fit.trim() : null,
    evidence,
    confidence: value.confidence === "high" || value.confidence === "medium" ? value.confidence : "low",
  };
}

export function buildScreeningPrompt(name: string, criteria: string | null, material: string) {
  const criteriaBlock = criteria?.trim()
    ? `本批次投资人明确筛选要求：\n${criteria.trim()}\n请同时判断项目本身与这些要求的匹配情况。`
    : "投资人未填写筛选要求。请完全基于材料，从股权投资视角自主选择重要维度完成初筛，不要假设用户存在未提供的偏好。";
  return {
    system: `你是资深股权投资初筛助手。你的任务是帮助投资人快速决定是否继续了解项目，不是撰写完整投资报告。只使用当前这一份项目材料，严禁引入其他项目事实。信息缺失必须明确指出，禁止编造。关键判断应给出材料原文短引。只输出一个 JSON 对象，不要 Markdown。`,
    user: `项目名称：${name}\n\n${criteriaBlock}\n\n项目材料：\n${material.slice(0, 50000)}\n\n返回结构：{"disposition":"continue|more_info|not_priority","summary":"一句话判断","strengths":["事实与理由"],"risks":["风险与理由"],"missing_information":["缺失信息"],"criteria_fit":"填写了筛选要求时说明匹配情况，否则为null","evidence":[{"claim":"所支持的判断","quote":"材料原文短引"}],"confidence":"high|medium|low"}。disposition 含义依次为建议继续了解、需要补充信息、暂不优先。confidence 仅表示当前材料对判断的支持程度。`,
  };
}

const runningBatches = new Set<string>();

export function kickScreeningBatch(batchId: string): void {
  if (runningBatches.has(batchId)) return;
  runningBatches.add(batchId);
  void processBatch(batchId).finally(() => runningBatches.delete(batchId));
}

async function processBatch(batchId: string): Promise<void> {
  const batches = await query<{ user_id: string; criteria: string | null }>(
    "SELECT user_id, criteria FROM screening_batches WHERE id = $1 AND status = 'processing'",
    [batchId]
  );
  const batch = batches[0];
  if (!batch) return;
  // 生产进程若在 AI 调用中途重启，数据库中可能遗留 processing。
  // 当前 runner 每个批次单实例运行；重新唤醒时先恢复为 pending，避免永久卡住。
  await query(
    "UPDATE screening_items SET status = 'pending', error = NULL WHERE batch_id = $1 AND status = 'processing'",
    [batchId]
  );
  const creds = await loadUserAICredentials(batch.user_id);
  if (!creds) {
    await query("UPDATE screening_items SET status = 'failed', error = $2 WHERE batch_id = $1 AND status IN ('pending','processing')", [batchId, "尚未配置可用的 AI 服务"]);
    await finishBatch(batchId);
    return;
  }

  for (;;) {
    const items = await query<{ id: string; name: string; extracted_text: string }>(
      `UPDATE screening_items SET status = 'processing', error = NULL
       WHERE id = (SELECT id FROM screening_items WHERE batch_id = $1 AND status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id, name, extracted_text`,
      [batchId]
    );
    const item = items[0];
    if (!item) break;
    try {
      const prompt = buildScreeningPrompt(item.name, batch.criteria, item.extracted_text);
      let raw = "";
      for await (const part of streamChat({
        provider: creds.provider,
        model: creds.model,
        apiKey: creds.apiKey,
        baseURL: creds.baseURL,
        freeQuotaMeta: freeQuotaMetaFor(creds, batch.user_id, "batch-screening"),
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      })) raw += part;
      const result = parseScreeningResult(raw);
      await query("UPDATE screening_items SET status = 'completed', result = $2, error = NULL WHERE id = $1", [item.id, result]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "初筛失败";
      await query("UPDATE screening_items SET status = 'failed', error = $2 WHERE id = $1", [item.id, message.slice(0, 500)]);
    }
  }
  await finishBatch(batchId);
}

async function finishBatch(batchId: string) {
  const rows = await query<{ failed: number; active: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS active
       FROM screening_items WHERE batch_id = $1`, [batchId]
  );
  if ((rows[0]?.active || 0) > 0) return;
  await query(
    `UPDATE screening_batches SET status = $2, completed_at = now() WHERE id = $1`,
    [batchId, (rows[0]?.failed || 0) > 0 ? "completed_with_errors" : "completed"]
  );
}
