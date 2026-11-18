import assert from "node:assert/strict";
import { mergeResearchPoints, mergeResearchTasks, normalizeResearchDraft } from "../src/lib/projectResearch";

const normalized = normalizeResearchDraft({ summary: "  研究摘要 ", judgments: [
  { kind: "concern", text: "收入尚未核验。" }, { kind: "concern", text: "收入 尚未核验" },
  { kind: "approved", text: "虚构决议" }, { kind: "support", text: "客户留存较高" },
], questions: ["核实订单。", "核实 订单", ""], decision: "建议补充材料后再议" });
assert.equal(normalized.judgments.length, 2);
assert.deepEqual(normalized.questions, ["核实订单。"]);
assert.deepEqual(mergeResearchPoints(["手工判断", "旧研究要点"], ["旧研究要点"], ["新研究要点", "手工判断。"]), {
  points: ["手工判断", "新研究要点"], inserted: ["新研究要点"],
});
assert.deepEqual(mergeResearchPoints(["手工修正的研究要点"], ["旧研究要点"], ["新研究要点"]).points, ["手工修正的研究要点", "新研究要点"]);
const full = Array.from({ length: 10 }, (_, i) => `已有${i}`);
assert.deepEqual(mergeResearchPoints(full, [], ["新增判断"]).points, full, "full input must preserve existing points; full research remains available through context");
const tasks = mergeResearchTasks([{ id: "task-1", title: "核实订单", status: "done" }], ["核实 订单。", "核实回款"], () => "task-2");
assert.equal(tasks.length, 2);
assert.equal(tasks[0].status, "done");
assert.equal(tasks[1].status, "open");
assert.equal(mergeResearchTasks(tasks, ["核实回款"], () => "unexpected").length, 2);
console.log("project research SOP: normalization, safe point merging, caps, task deduplication and completed-state preservation passed");
