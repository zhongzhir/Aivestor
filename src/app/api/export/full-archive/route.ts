import { NextResponse } from "next/server";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getUserProfile, type UserProfile } from "@/lib/user-profile";
import { STAGE_LABELS } from "@/lib/stages";
import { EXPORT_FOOTER, exportDateStr } from "@/lib/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STYLE_LABEL: Record<string, string> = {
  financial: "财务回报导向",
  strategic: "战略布局导向",
  founder_first: "Founder 优先",
  thesis_driven: "主题投资",
};

const ENTRY_TYPE_LABEL: Record<string, string> = {
  thesis: "投资逻辑",
  industry: "行业认知",
  prediction: "预测与复盘",
  conversation_digest: "对话沉淀",
  project: "项目库",
  chunk: "文档切片",
  document_chunk: "文档切片",
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  evaluating: "评估中",
  invested: "已投",
  passed: "已 Pass",
  exited: "已退出",
};

// 一个「标签：值」段落
function field(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}：`, bold: true }),
      new TextRun({ text: value }),
    ],
  });
}

function para(text = ""): Paragraph {
  return new Paragraph({ children: text ? [new TextRun({ text })] : [] });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text })] });
}

function profileParagraphs(p: UserProfile | null): Paragraph[] {
  if (!p) return [para("（未填写投资人画像）")];
  const out: Paragraph[] = [];
  if (p.focus_stages?.length) out.push(field("专注阶段", p.focus_stages.join("、")));
  if (p.focus_sectors?.length) out.push(field("关注赛道", p.focus_sectors.join("、")));
  if (p.investment_style)
    out.push(field("投资风格", STYLE_LABEL[p.investment_style] ?? p.investment_style));
  if (p.check_size) out.push(field("单笔规模", p.check_size));
  if (p.typical_hold_period) out.push(field("典型持有周期", p.typical_hold_period));
  if (p.decision_criteria) out.push(field("核心判断标准", p.decision_criteria));
  if (p.avoid_patterns) out.push(field("明确回避", p.avoid_patterns));
  if (p.output_preference) out.push(field("输出偏好", p.output_preference));
  if (p.self_intro) out.push(field("补充背景", p.self_intro));
  if (p.extra_context) out.push(field("其他补充", p.extra_context));
  return out.length ? out : [para("（未填写投资人画像）")];
}

interface SkillRow {
  name: string;
  description: string | null;
  category: string | null;
  prompt_template: string;
}

interface KbRow {
  entry_type: string | null;
  source_type: string | null;
  title: string | null;
  content: string;
}

interface ProjectRow {
  id: string;
  name: string;
  company_name: string | null;
  industry: string | null;
  stage: string | null;
  status: string;
  summary: string | null;
  judgment_points: string[] | null;
}

interface JudgmentRow {
  project_id: string;
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
}

// GET /api/export/full-archive — 聚合全部数据生成完整投资档案 .docx
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const [profile, skills, kb, projects, judgments] = await Promise.all([
    getUserProfile(userId),
    query<SkillRow>(
      `SELECT name, description, category, prompt_template
         FROM user_custom_skills WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    ),
    query<KbRow>(
      `SELECT entry_type, source_type, title, content
         FROM knowledge_base_entries WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    ),
    query<ProjectRow>(
      `SELECT id, name, company_name, industry, stage, status, summary,
              judgment_points
         FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    ),
    query<JudgmentRow>(
      `SELECT project_id, stage, bull_case, bear_case, founder_assessment,
              key_hypothesis, confidence_level
         FROM investment_judgments WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    ),
  ]);

  const judgmentsByProject = new Map<string, JudgmentRow[]>();
  for (const j of judgments) {
    const list = judgmentsByProject.get(j.project_id);
    if (list) list.push(j);
    else judgmentsByProject.set(j.project_id, [j]);
  }

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "完整投资档案" })],
    }),
    para(`导出日期：${exportDateStr()}`),
    para(),
  ];

  // 一、投资人基本设定
  children.push(heading("一、投资人基本设定", HeadingLevel.HEADING_1));
  children.push(...profileParagraphs(profile));
  children.push(para());

  // 二、自定义 SKILL 列表
  children.push(heading(`二、自定义 SKILL 列表（${skills.length}）`, HeadingLevel.HEADING_1));
  if (skills.length === 0) {
    children.push(para("（暂无自建 SKILL）"));
  } else {
    for (const s of skills) {
      children.push(heading(s.name, HeadingLevel.HEADING_2));
      if (s.description) children.push(para(s.description));
      children.push(para(s.prompt_template));
      children.push(para());
    }
  }

  // 三、知识库条目
  children.push(heading(`三、知识库条目（${kb.length}）`, HeadingLevel.HEADING_1));
  if (kb.length === 0) {
    children.push(para("（知识库暂无条目）"));
  } else {
    kb.forEach((e, i) => {
      const groupLabel =
        e.source_type === "manual"
          ? "手动笔记"
          : ENTRY_TYPE_LABEL[e.entry_type ?? "chunk"] ?? "条目";
      const title = e.title?.trim() || `条目 ${i + 1}`;
      children.push(heading(`[${groupLabel}] ${title}`, HeadingLevel.HEADING_3));
      children.push(para(e.content.trim()));
      children.push(para());
    });
  }

  // 四、项目与投资判断
  children.push(heading(`四、项目与投资判断（${projects.length}）`, HeadingLevel.HEADING_1));
  if (projects.length === 0) {
    children.push(para("（暂无项目）"));
  } else {
    for (const p of projects) {
      children.push(heading(p.name, HeadingLevel.HEADING_2));
      if (p.company_name) children.push(field("公司主体", p.company_name));
      const basics: string[] = [];
      if (p.industry) basics.push(p.industry);
      if (p.stage) basics.push(p.stage);
      basics.push(PROJECT_STATUS_LABEL[p.status] ?? p.status);
      children.push(field("行业 / 阶段 / 状态", basics.join(" · ")));
      if (p.summary) children.push(field("概述", p.summary));

      const points = Array.isArray(p.judgment_points) ? p.judgment_points : [];
      if (points.length) {
        children.push(para("判断要点："));
        for (const pt of points) {
          children.push(
            new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: String(pt) })] })
          );
        }
      }

      const projJudgments = judgmentsByProject.get(p.id) ?? [];
      if (projJudgments.length) {
        children.push(para("投资判断记录："));
        for (const j of projJudgments) {
          const stage = STAGE_LABELS[j.stage] ?? j.stage;
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `[${stage}]`, bold: true })],
            })
          );
          if (j.bull_case?.trim()) children.push(field("看好的理由", j.bull_case.trim()));
          if (j.bear_case?.trim()) children.push(field("主要顾虑", j.bear_case.trim()));
          if (j.founder_assessment?.trim())
            children.push(field("对创始人的判断", j.founder_assessment.trim()));
          if (j.key_hypothesis?.trim())
            children.push(field("关键待验证假设", j.key_hypothesis.trim()));
          if (j.confidence_level != null)
            children.push(field("信心评分", `${j.confidence_level}/5`));
        }
      }
      children.push(para());
    }
  }

  // 署名
  children.push(para());
  children.push(
    new Paragraph({
      children: [new TextRun({ text: EXPORT_FOOTER, italics: true })],
    })
  );

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const filename = `aivestor-archive-${exportDateStr()}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
