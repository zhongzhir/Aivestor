import { query, withTransaction } from "@/lib/db";
import { ResourceForbiddenError } from "@/lib/resourceAccess";
import type { SavedProjectResearch } from "@/lib/projectResearch";

interface Entry { id: string; metadata: { source_conversation_id: string; project_research: SavedProjectResearch } }
export async function conversationResearchTasks(projectId: string) {
  const entries = await query<Entry>(
    `SELECT id, metadata FROM knowledge_base_entries WHERE project_id = $1 AND metadata ? 'project_research' ORDER BY updated_at DESC`, [projectId]);
  return entries.flatMap((entry) => entry.metadata.project_research.tasks.map((task) => ({
    ...task, id: `conversation:${entry.id}:${task.id}`, priority: "P1", details: "来自项目研究对话",
    source_href: `/chat?project=${projectId}&conversation=${entry.metadata.source_conversation_id}`,
  })));
}

export async function updateConversationResearchTask(projectId: string, taskId: string, body: { status?: unknown; owner?: unknown; dueDate?: unknown }) {
  const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  const match = taskId.match(new RegExp(`^conversation:(${uuid}):(${uuid})$`, "i"));
  if (!match) throw new ResourceForbiddenError("任务不存在", 404);
  return withTransaction(async (client) => {
    const { rows: [entry] } = await client.query<Entry>(
      `SELECT id, metadata FROM knowledge_base_entries WHERE id = $1 AND project_id = $2 AND metadata ? 'project_research' FOR UPDATE`, [match[1], projectId]);
    const task = entry?.metadata.project_research.tasks.find((item) => item.id === match[2]);
    if (!task) throw new ResourceForbiddenError("任务不存在", 404);
    if (body.status != null) task.status = body.status as typeof task.status;
    if (Object.prototype.hasOwnProperty.call(body, "owner")) task.owner = typeof body.owner === "string" ? body.owner.trim().slice(0,120) : null;
    if (Object.prototype.hasOwnProperty.call(body, "dueDate")) task.due_date = typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null;
    await client.query("UPDATE knowledge_base_entries SET metadata = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(entry.metadata), entry.id]);
    return { ...task, id: taskId };
  });
}
