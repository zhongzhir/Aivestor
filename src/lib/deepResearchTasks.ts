import type { DeepResearchExternalResult } from "@/lib/deepResearchExternal";
import type { EvidenceLedgerItem } from "@/lib/deepResearchWorkpaper";

export function buildDueDiligenceTasks(
  ledger: EvidenceLedgerItem[],
  external: DeepResearchExternalResult
): Array<{
  evidenceItemId: string;
  title: string;
  details: string;
  priority: "P0" | "P1" | "P2";
}> {
  const tasks = ledger
    .filter((item) => item.status === "gap" || item.status === "inconsistent" || (item.priority === "P0" && item.verificationAction))
    .map((item) => ({
      evidenceItemId: item.id,
      title: item.verificationAction || `核验：${item.claim}`,
      details: `关联主张：${item.claim}\n投资影响：${item.investmentImpact || "待判断"}`,
      priority: item.priority,
    }));
  external.unresolvedGaps.forEach((gap, index) => {
    tasks.push({
      evidenceItemId: `EXT-GAP-${index + 1}`,
      title: `补充外部证据：${gap}`,
      details: "项目级外部取证未能闭合该问题，需要人工访谈、授权数据库或项目方材料补充。",
      priority: "P1",
    });
  });
  return tasks
    .map((task) => ({ ...task, title: task.title.trim().slice(0, 240) }))
    .filter((task) => task.title)
    .filter((task, index, list) => list.findIndex((other) => other.evidenceItemId === task.evidenceItemId) === index)
    .slice(0, 60);
}
