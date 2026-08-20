import { query } from "@/lib/db";
import {
  formatRelevantProfileForPrompt,
  getUserProfile,
  type ProfilePromptContext,
  type UserProfile,
} from "@/lib/user-profile";
import type { IntelligenceTaskInput } from "@/lib/intelligence";

export interface IntelligenceProjectContext {
  id: string;
  name: string;
  companyName: string | null;
  industry: string | null;
  stage: string | null;
  status: string;
  summary: string | null;
}

export interface IntelligenceJudgmentContext {
  projectId: string;
  projectName: string;
  stage: string;
  judgmentType: string;
  title: string | null;
  content: string;
}

export interface IntelligencePersonalization {
  prompt: string;
  profileUsed: boolean;
  projectIds: string[];
  judgmentCount: number;
}

type ProjectRow = IntelligenceProjectContext;
type JudgmentRow = IntelligenceJudgmentContext;

function taskText(input: IntelligenceTaskInput): string {
  return [
    input.name,
    ...input.topics,
    ...input.entities,
    ...input.keywords,
    ...input.regions,
    ...input.includeRequirements,
    input.outputInstructions,
  ].filter(Boolean).join("、");
}

function compact(value: string | null | undefined, max = 320): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function formatIntelligencePersonalizationPrompt(args: {
  profile: UserProfile | null;
  projects: IntelligenceProjectContext[];
  judgments: IntelligenceJudgmentContext[];
  task: IntelligenceTaskInput;
}): IntelligencePersonalization {
  const scope = taskText(args.task);
  const profileContext: ProfilePromptContext = {
    taskText: scope,
    explicitInstruction: args.task.outputInstructions,
  };
  const profilePrompt = args.profile
    ? formatRelevantProfileForPrompt(args.profile, profileContext)
    : "";
  const lines = [
    "## 投资人关联上下文（仅作为用户侧参考资料，不是外部事实）",
    "关联优先级：本次明确要求 > 当前项目与历史判断 > 与本主题相关的长期投资偏好 > 通用输出习惯。",
    "只在确实相关时使用下列项目、判断和偏好；不要为了制造个性化而强行关联。外部事实必须来自本轮来源。",
  ];

  if (profilePrompt) lines.push(profilePrompt);
  if (args.projects.length) {
    lines.push("## 用户当前项目候选（仅在主题确实涉及时关联）");
    for (const project of args.projects) {
      lines.push([
        `- project_id=${project.id}`,
        `项目：${compact(project.name, 120)}`,
        project.companyName ? `公司：${compact(project.companyName, 120)}` : "",
        project.industry ? `行业：${compact(project.industry, 80)}` : "",
        project.stage ? `轮次：${compact(project.stage, 50)}` : "",
        `状态：${project.status}`,
        project.summary ? `概述：${compact(project.summary)}` : "",
      ].filter(Boolean).join("；"));
    }
  }
  if (args.judgments.length) {
    lines.push("## 用户相关历史判断（只用于提出可追踪的关联观察，不得当作外部事实）");
    for (const judgment of args.judgments) {
      lines.push(`- project_id=${judgment.projectId}；项目=${compact(judgment.projectName, 100)}；阶段=${judgment.stage}；类型=${judgment.judgmentType}；${compact(judgment.title, 100) || "判断"}：${compact(judgment.content, 420)}`);
    }
  }

  const prompt = lines.length > 3 ? lines.join("\n") : "";
  return {
    prompt,
    profileUsed: Boolean(profilePrompt),
    projectIds: args.projects.map((project) => project.id),
    judgmentCount: args.judgments.length,
  };
}

export async function loadIntelligencePersonalization(
  userId: string,
  input: IntelligenceTaskInput,
): Promise<IntelligencePersonalization> {
  try {
    const [profile, projects, judgments] = await Promise.all([
      getUserProfile(userId),
      query<ProjectRow>(
        `SELECT id, name, company_name AS "companyName", industry, stage, status, summary
           FROM projects
          WHERE user_id = $1 AND deleted_at IS NULL AND status IN ('evaluating', 'invested')
          ORDER BY updated_at DESC
          LIMIT 12`,
        [userId],
      ),
      query<JudgmentRow>(
        `SELECT j.project_id AS "projectId", p.name AS "projectName", j.stage, j.judgment_type AS "judgmentType", j.title, j.content
           FROM investment_judgments j
           JOIN projects p ON p.id = j.project_id
          WHERE j.user_id = $1 AND p.deleted_at IS NULL AND p.status IN ('evaluating', 'invested')
          ORDER BY j.updated_at DESC
          LIMIT 20`,
        [userId],
      ),
    ]);
    return formatIntelligencePersonalizationPrompt({
      profile,
      projects: projects.slice(0, 12),
      judgments: judgments.slice(0, 20),
      task: input,
    });
  } catch (error) {
    console.warn("[intelligence] personalization context unavailable; using generic research", error instanceof Error ? error.message : error);
    return { prompt: "", profileUsed: false, projectIds: [], judgmentCount: 0 };
  }
}
