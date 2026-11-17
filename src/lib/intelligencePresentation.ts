/** Translate historical system summaries without altering research facts or stored reports. */
export function intelligenceOverviewForReader(value: string): string {
  const outsideEvents = value.match(/^本次已核验来源中有 (\d+) 条事项的明确事件日期不在报告窗口内/);
  if (outsideEvents) return `本次找到的 ${outsideEvents[1]} 条相关动态发生在所选日期范围之外，因此未列为本期新增。暂未发现可确认的新增动态，建议持续关注。`;
  const outsideSources = value.match(/^本次(?:命中的|检索命中的) (\d+) 个已知发布日期来源/);
  if (outsideSources) return `本次找到的 ${outsideSources[1]} 篇报道发布于所选日期范围之外，尚未确认本期有新增动态。建议持续关注，或扩大日期范围查看。`;
  if (value.startsWith("本次已核验部分来源，但没有形成通过事实级来源绑定的事项")) return "已阅读部分公开资料，暂未发现依据充分的新增动态。建议持续关注，或扩大关注范围。";
  const items = value.match(/^本次基于已核验来源形成 (\d+) 条事项/);
  if (items) return `本次根据公开资料整理了 ${items[1]} 条相关动态。${value.includes("覆盖不完整") ? "部分信息来源暂时无法访问，内容可能不完整。" : ""}`;
  return value;
}
