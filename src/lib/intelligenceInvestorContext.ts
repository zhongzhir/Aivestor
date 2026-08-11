import { query } from "@/lib/db";
import { searchLayeredKnowledge } from "@/lib/knowledgeSearch";
import { buildAccessScope, scopedProjectWhere } from "@/lib/resourceAccess";
import { formatProfileForPrompt, getUserProfile } from "@/lib/user-profile";

type ProjectRow = { id: string; name: string; company_name: string | null; industry: string | null; process_stage: string | null; judgment_points: string[] | null };
type JudgmentRow = { project_id: string; bull_case: string | null; bear_case: string | null; outcome: string | null; created_at: string };

/** Compact and access-scoped; the AI, not code, decides what is relevant. */
export async function buildInvestorResearchContext(userId: string, taskText: string): Promise<string> {
  const scope = await buildAccessScope(userId);
  const where = scopedProjectWhere(scope, 1, { alias: "p" });
  const [profile, projects, knowledge] = await Promise.all([
    getUserProfile(userId),
    query<ProjectRow>(`SELECT p.id,p.name,p.company_name,p.industry,p.process_stage,p.judgment_points FROM projects p WHERE ${where.sql} ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC LIMIT 6`, where.params),
    searchLayeredKnowledge(scope, taskText, { topKPersonal: 3, topKOrg: 3 }),
  ]);
  const ids = projects.map((item) => item.id);
  const judgments = ids.length ? await query<JudgmentRow>("SELECT project_id,bull_case,bear_case,outcome,created_at FROM investment_judgments WHERE project_id = ANY($1::uuid[]) AND user_id = $2 ORDER BY created_at DESC LIMIT 12", [ids, userId]) : [];
  const byProject = new Map<string, JudgmentRow[]>();
  for (const item of judgments) byProject.set(item.project_id, [...(byProject.get(item.project_id) ?? []), item]);
  return formatInvestorResearchContext({ profile: profile ? formatProfileForPrompt(profile) : "", projects, judgments: byProject, knowledge: knowledge.map((item) => item.content) });
}

export function formatInvestorResearchContext(input: { profile: string; projects: ProjectRow[]; judgments: Map<string, JudgmentRow[]>; knowledge: string[] }): string {
  const parts: string[] = [];
  if (input.profile) parts.push(input.profile);
  const projects = input.projects.map((project) => ({ name: project.name, company: project.company_name, industry: project.industry, stage: project.process_stage, judgmentPoints: project.judgment_points?.slice(0, 4), recentJudgments: (input.judgments.get(project.id) ?? []).slice(0, 2).map((item) => ({ bull: item.bull_case, bear: item.bear_case, outcome: item.outcome })) }));
  if (projects.length) parts.push(`## 可见项目与历史判断（仅在确有证据时关联）\n${JSON.stringify(projects)}`);
  if (input.knowledge.length) parts.push(`## 与本次研究相关的私有知识（仅作判断背景）\n${input.knowledge.slice(0, 6).map((item) => `- ${item.slice(0, 500)}`).join("\n")}`);
  return parts.length ? `${parts.join("\n\n")}\n\n你自主判断市场事件与上述上下文的关联性、排序和解释；不得捏造项目关联。重要但不直接匹配画像的市场信号仍应保留，并说明其独立重要性。将已确认事实与投资启示分开，自然表达，不复述画像或内部上下文。` : "";
}
