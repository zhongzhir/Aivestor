/** The small, editable handoff from a conversation to the existing project SOP. */
export type ResearchJudgmentKind = "support" | "concern" | "hypothesis";
export interface ProjectResearchDraft {
  summary: string;
  judgments: Array<{ kind: ResearchJudgmentKind; text: string }>;
  questions: string[];
  decision: string;
}
export interface ResearchTask {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done" | "dismissed";
  owner?: string | null;
  due_date?: string | null;
}
export interface SavedProjectResearch {
  revision: string;
  draft: ProjectResearchDraft;
  saved_at: string;
  judgment_id?: string;
  decision_id?: string;
  inserted_points: string[];
  tasks: ResearchTask[];
}

export const RESEARCH_KIND_LABELS: Record<ResearchJudgmentKind, string> = {
  support: "看好", concern: "顾虑", hypothesis: "待验证",
};

export function researchTextKey(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function normalizeResearchDraft(value: unknown): ProjectResearchDraft {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (v: unknown, limit: number) => typeof v === "string" ? v.trim().slice(0, limit) : "";
  const judgments = (Array.isArray(raw.judgments) ? raw.judgments : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const kind = item.kind as ResearchJudgmentKind;
    const content = text(item.text, 800);
    return content && ["support", "concern", "hypothesis"].includes(kind) ? [{ kind, text: content }] : [];
  }).filter((item, i, all) => all.findIndex((other) => researchTextKey(other.text) === researchTextKey(item.text)) === i).slice(0, 10);
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((item) => text(item, 500)).filter(Boolean)
    .filter((item, i, all) => all.findIndex((other) => researchTextKey(other) === researchTextKey(item)) === i).slice(0, 10);
  return { summary: text(raw.summary, 1500), judgments, questions, decision: text(raw.decision, 3000) };
}

export function researchPointText(item: ProjectResearchDraft["judgments"][number]) {
  return `${RESEARCH_KIND_LABELS[item.kind]}：${item.text}`;
}

/** Only replace points this conversation inserted; preserve manual/other-conversation input. */
export function mergeResearchPoints(current: string[], previouslyInserted: string[], incoming: string[]) {
  const old = new Set(previouslyInserted.map(researchTextKey));
  const points = current.filter((point) => point.trim() && !old.has(researchTextKey(point)));
  const inserted: string[] = [];
  for (const point of incoming) {
    if (points.some((item) => researchTextKey(item) === researchTextKey(point))) continue;
    if (points.length >= 10) break;
    points.push(point); inserted.push(point);
  }
  return { points, inserted };
}

/** Re-extracting a question must not reopen completed or dismissed work. */
export function mergeResearchTasks(previous: ResearchTask[], incoming: string[], newId: () => string) {
  const tasks = previous.map((task) => ({ ...task }));
  for (const title of incoming) {
    if (!tasks.some((task) => researchTextKey(task.title) === researchTextKey(title))) {
      tasks.push({ id: newId(), title, status: "open" });
    }
  }
  return tasks;
}

export function formatResearchDraft(draft: ProjectResearchDraft) {
  return [draft.summary, ...draft.judgments.map(researchPointText),
    ...draft.questions.map((q) => `待核实：${q}`), draft.decision && `决策参考（草稿）：${draft.decision}`]
    .filter(Boolean).join("\n");
}
