import { createHash, randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { assertProjectAccess, type AccessScope, ResourceForbiddenError } from "@/lib/resourceAccess";
import { digestSources, type ResearchMessage, type ConversationSource } from "@/lib/conversationResearch";
import { formatResearchDraft, mergeResearchPoints, mergeResearchTasks, normalizeResearchDraft, researchPointText, researchTextKey,
  type ProjectResearchDraft, type SavedProjectResearch } from "@/lib/projectResearch";

export interface ResearchConversation {
  id: string; title: string | null; project_id: string | null; messages: ResearchMessage[];
}
interface ResearchEntry { id: string; metadata: { project_research?: SavedProjectResearch; [key: string]: unknown } }

export function conversationRevision(conversation: ResearchConversation) {
  // JSONB may reorder object keys; revisions depend on research content, not serialization order.
  const messages = conversation.messages.map((m) => [m.role, m.content, m.ts,
    m.sources?.map((s) => [s.id, s.title, s.locator, s.source_type, s.content, s.data_as_of, s.href])]);
  return createHash("sha256").update(JSON.stringify([conversation.project_id, messages])).digest("hex");
}

export async function loadResearchConversation(id: string, scope: AccessScope) {
  const [conversation] = await query<ResearchConversation>(
    "SELECT id, title, project_id, messages FROM conversations WHERE id = $1 AND user_id = $2", [id, scope.userId]);
  if (!conversation) throw new ResourceForbiddenError("对话不存在", 404);
  if (!conversation.project_id) throw new ResourceForbiddenError("请先选择研究项目", 422);
  await assertProjectAccess(scope, conversation.project_id, "write");
  return conversation;
}

export async function loadSavedResearch(conversationId: string, userId: string) {
  const [entry] = await query<ResearchEntry>(
    `SELECT id, metadata FROM knowledge_base_entries WHERE user_id = $1
       AND metadata->>'source_conversation_id' = $2 AND metadata ? 'project_research'
       ORDER BY updated_at DESC LIMIT 1`, [userId, conversationId]);
  return entry;
}

export async function saveProjectResearch(scope: AccessScope, conversationId: string, revision: string, draft: ProjectResearchDraft) {
  return withTransaction(async (client) => {
    const { rows: [conversation] } = await client.query<ResearchConversation>(
      "SELECT id, title, project_id, messages FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE", [conversationId, scope.userId]);
    if (!conversation?.project_id) throw new ResourceForbiddenError("项目对话不存在", 404);
    if (conversationRevision(conversation) !== revision) throw new ResourceForbiddenError("对话有新内容，请重新整理后保存", 409);
    // Serialize project-level merges, including different conversations, without changing the stage.
    const { rows: [project] } = await client.query<{ name: string; process_stage: string; judgment_points: string[] | null }>(
      "SELECT name, process_stage, judgment_points FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [conversation.project_id]);
    if (!project) throw new ResourceForbiddenError("项目不存在", 404);
    const access = await assertProjectAccess(scope, conversation.project_id, "write");
    const { rows: entries } = await client.query<ResearchEntry>(
      `SELECT id, metadata FROM knowledge_base_entries WHERE project_id = $1 AND metadata ? 'project_research' FOR UPDATE`, [conversation.project_id]);
    const entry = entries.find((item) => item.metadata.source_conversation_id === conversationId && item.metadata.author_id === scope.userId);
    const previous = entry?.metadata.project_research;
    if (previous?.revision === revision && JSON.stringify(normalizeResearchDraft(previous.draft)) === JSON.stringify(draft)) {
      return { success: true, unchanged: true, project_id: conversation.project_id, research: previous, points: project.judgment_points ?? [] };
    }
    const sources = digestSources(conversation.messages);
    const origin = `/chat?project=${conversation.project_id}&conversation=${conversationId}`;
    const sourceText = sources.map((s) => `${s.title || "参考资料"}${s.locator ? ` · ${s.locator}` : ""}`).filter((s, i, all) => all.indexOf(s) === i).join("；");
    const provenance = `来源对话：${origin}${sourceText ? `\n参考来源：${sourceText}` : ""}`;
    const merged = mergeResearchPoints(project.judgment_points ?? [], previous?.inserted_points ?? [], draft.judgments.map(researchPointText));
    await client.query("UPDATE projects SET judgment_points = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(merged.points), conversation.project_id]);
    let judgmentId = previous?.judgment_id;
    if (draft.judgments.length || judgmentId) {
      const group = (kind: string) => draft.judgments.filter((j) => j.kind === kind).map((j) => j.text).join("\n") || null;
      const metadata = JSON.stringify({ source_conversation_id: conversationId, sources, evidence_status: "discussion", adopted_at: new Date().toISOString() });
      const values = [formatResearchDraft(draft) + "\n" + provenance, group("support"), group("concern"), group("hypothesis"), metadata];
      const updated = judgmentId ? await client.query(`UPDATE investment_judgments SET content = $1, bull_case = $2, bear_case = $3, key_hypothesis = $4,
          metadata = $5, updated_at = NOW() WHERE id = $6 AND project_id = $7 AND user_id = $8 AND stage = $9 RETURNING id`, [...values, judgmentId, conversation.project_id, scope.userId, project.process_stage]) : null;
      if (!updated?.rows.length && draft.judgments.length) {
        const { rows: [judgment] } = await client.query<{ id: string }>(
          `INSERT INTO investment_judgments (content, bull_case, bear_case, key_hypothesis, metadata, project_id, user_id, org_id, stage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [...values, conversation.project_id, scope.userId, access.orgId, project.process_stage]);
        judgmentId = judgment.id;
      }
    }
    let decisionId = previous?.decision_id;
    if (draft.decision || decisionId) {
      const note = `${draft.decision || "本次研究未保留决策建议。"}\n\n${provenance}`;
      const updated = decisionId ? await client.query(
        `UPDATE project_decision_events SET note = $1 WHERE id = $2 AND project_id = $3 AND user_id = $4 AND stage = $5 AND status = 'draft' RETURNING id`,
        [note, decisionId, conversation.project_id, scope.userId, project.process_stage]) : null;
      if (!updated?.rows.length && draft.decision) {
        const { rows: [decision] } = await client.query<{ id: string }>(
          `INSERT INTO project_decision_events (project_id,user_id,org_id,stage,event_type,status,title,note)
           VALUES ($1,$2,$3,$4,'stage_gate','draft',$5,$6) RETURNING id`,
          [conversation.project_id, scope.userId, access.orgId, project.process_stage, `${project.name} · 研究对话决策参考`.slice(0,120), note]);
        decisionId = decision.id;
      }
    }
    // Tasks use the existing research entry, so no new table or migration is required.
    const otherTasks = entries.filter((item) => item.id !== entry?.id).flatMap((item) => item.metadata.project_research?.tasks ?? []);
    const questions = draft.questions.filter((q) => !otherTasks.some((task) => researchTextKey(task.title) === researchTextKey(q)));
    const research: SavedProjectResearch = {
      revision, draft, saved_at: new Date().toISOString(), judgment_id: judgmentId, decision_id: decisionId,
      inserted_points: merged.inserted, tasks: mergeResearchTasks(previous?.tasks ?? [], questions, randomUUID),
    };
    const metadata = JSON.stringify({ ...entry?.metadata, source_conversation_id: conversationId, conversation_title: conversation.title,
      author_id: scope.userId, project_id: conversation.project_id, project_name: project.name, sources, evidence_status: "discussion", project_research: research });
    const structured = JSON.stringify({ summary: draft.summary, key_insights: draft.judgments.map(researchPointText), open_questions: draft.questions,
      watch_points: draft.questions, mindset_shift: null });
    if (entry) {
      await client.query(`UPDATE knowledge_base_entries SET content = $1, structured_data = $2, metadata = $3, updated_at = NOW(), embedding = NULL, embedding_model = NULL WHERE id = $4`,
        [formatResearchDraft(draft), structured, metadata, entry.id]);
    } else {
      await client.query(`INSERT INTO knowledge_base_entries (user_id, project_id, content, source_type, entry_type, structured_data, review_status, tags, metadata)
        VALUES ($1,$2,$3,'manual','conversation_digest',$4,'approved',$5,$6)`,
        [scope.userId, conversation.project_id, formatResearchDraft(draft), structured, JSON.stringify(["项目研究", project.name]), metadata]);
    }
    return { success: true, unchanged: false, project_id: conversation.project_id, research, points: merged.points };
  });
}

/** Explicitly adopted project research is always available to report/decision generation. */
export async function projectResearchContext(projectId: string) {
  const entries = await query<ResearchEntry>(
    `SELECT id, metadata FROM knowledge_base_entries WHERE project_id = $1 AND metadata ? 'project_research'
     ORDER BY updated_at DESC LIMIT 12`, [projectId]);
  if (!entries.length) return "";
  return "\n\n## 用户已纳入项目的研究成果\n以下是用户采纳的研究判断与待核实事项，不等于已证实事实或正式投资决议。结合原始材料核验；如与材料冲突，说明差异。未完成事项不能声称已核实。\n" + entries.map((entry) => {
    const research = entry.metadata.project_research!;
    const sources = (entry.metadata.sources as ConversationSource[] | undefined) ?? [];
    const citations = sources.slice(0, 8).map((source) => `${source.title || "参考资料"}${source.locator ? ` · ${source.locator}` : ""}：${source.content.slice(0, 500)}`).join("\n");
    return `${formatResearchDraft(research.draft)}\n待办进展：${research.tasks.map((task) => `${task.title}（${task.status === "done" ? "用户标记已完成，仍需核验依据" : task.status === "dismissed" ? "已不再跟进，不表示已证实" : "待核实"}）`).join("；")}\n来源对话：/chat?project=${projectId}&conversation=${entry.metadata.source_conversation_id}\n讨论所引资料（引用时使用原资料名与定位，不能把讨论本身当作事实证据）：\n${citations}\n`;
  }).join("\n").slice(0, 14000);
}
