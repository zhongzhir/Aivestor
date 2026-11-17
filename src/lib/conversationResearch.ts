/** Evidence is stored with each answer in the existing conversations.messages JSON. */
export interface ConversationSource {
  content: string;
  source_type: string | null;
  id?: string;
  title?: string;
  locator?: string;
  data_as_of?: string | null;
  href?: string;
}

export interface ResearchMessage {
  role: "user" | "assistant";
  content: string;
  ts?: string;
  sources?: ConversationSource[];
}

export function researchQuery(message: string, history: ResearchMessage[], projectName?: string) {
  // Short follow-ups need the topic, not an invented expansion from another model.
  const previous = history.filter((item) => item.role === "user").slice(-2);
  return [projectName, ...previous.map((item) => item.content.slice(0, 500)), message]
    .filter(Boolean).join("\n").slice(-2200);
}

export function researchHistory(history: ResearchMessage[], budget = 18000): ResearchMessage[] {
  const recent: ResearchMessage[] = [];
  let remaining = budget;
  for (let i = history.length - 1; i >= 0 && remaining > 0; i--) {
    const item = history[i];
    const content = item.content.slice(-remaining);
    recent.unshift({ role: item.role, content });
    remaining -= content.length;
  }
  // APIs require a user-led conversation; old turns remain stored in full.
  if (recent[0]?.role === "assistant") recent.shift();
  return recent;
}

export function researchTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const terms = words.flatMap((word) => /^[\u4e00-\u9fff]+$/.test(word)
    ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
    : [word]);
  return [...new Set(terms)].slice(-80);
}

export function relevance(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

export function sourcePrompt(sources: ConversationSource[]) {
  return sources.map((source, index) =>
    `[${index + 1}] ${source.title || source.source_type || "知识条目"}${source.locator ? ` · ${source.locator}` : ""}${source.data_as_of ? ` · 数据截止 ${source.data_as_of}` : ""}\n${source.content}`
  ).join("\n\n");
}

export function digestSources(messages: ResearchMessage[]): ConversationSource[] {
  const unique = new Map<string, ConversationSource>();
  for (const message of messages) {
    for (const source of message.sources ?? []) {
      // Keep different excerpts from the same document; never renumber old answers.
      const key = `${source.id ?? source.title}:${source.locator}:${source.content}`;
      unique.set(key, source);
    }
  }
  return [...unique.values()].slice(-40);
}
