import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidSkillCategory, SKILL_STAGES } from "@/lib/skills";
import { buildAccessScope } from "@/lib/resourceAccess";

interface CustomSkillRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  prompt_template: string;
  applicable_stages: string[];
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/skills/custom — 自建 SKILL 列表：本人的 + 组织共享的
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    // 个人版退化为仅 user_id = $1，与现状等价。
    const scope = await buildAccessScope(session.user.id);
    const orgId = scope.org?.orgId ?? null;
    const skills = await query<CustomSkillRow>(
      `SELECT id, name, description, category, prompt_template,
              applicable_stages, org_id, created_at, updated_at
         FROM user_custom_skills
        WHERE user_id = $1${orgId ? " OR org_id = $2" : ""}
        ORDER BY created_at DESC`,
      orgId ? [session.user.id, orgId] : [session.user.id]
    );
    return NextResponse.json({ skills });
  } catch (e) {
    console.error("[skills/custom] GET 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 }
    );
  }
}

// 校验并归一化 applicable_stages
function normalizeStages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (s): s is string =>
      typeof s === "string" && (SKILL_STAGES as readonly string[]).includes(s)
  );
}

// POST /api/skills/custom — 创建自建 SKILL
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    let body: {
      name?: string;
      description?: string;
      category?: string;
      prompt_template?: string;
      applicable_stages?: unknown;
      shared?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const name = body.name?.trim();
    const promptTemplate = body.prompt_template?.trim();
    if (!name) {
      return NextResponse.json({ error: "请填写 SKILL 名称" }, { status: 422 });
    }
    if (!promptTemplate) {
      return NextResponse.json(
        { error: "请填写 Prompt 模板" },
        { status: 422 }
      );
    }
    const category =
      body.category && isValidSkillCategory(body.category)
        ? body.category
        : null;

    // 组织共享 SKILL：需 partner+ 且有 org（1.2 矩阵）；否则创建为个人 SKILL。
    let orgId: string | null = null;
    if (body.shared) {
      const scope = await buildAccessScope(session.user.id);
      if (
        !scope.org ||
        (scope.org.role !== "admin" && scope.org.role !== "partner")
      ) {
        return NextResponse.json(
          { error: "仅 partner 及以上可创建组织共享 SKILL" },
          { status: 403 }
        );
      }
      orgId = scope.org.orgId;
    }

    const rows = await query<CustomSkillRow>(
      `INSERT INTO user_custom_skills
         (user_id, name, description, category, prompt_template, applicable_stages, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, description, category, prompt_template,
                 applicable_stages, org_id, created_at, updated_at`,
      [
        session.user.id,
        name,
        body.description?.trim() || null,
        category,
        promptTemplate,
        normalizeStages(body.applicable_stages),
        orgId,
      ]
    );

    return NextResponse.json({ skill: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[skills/custom] POST 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 }
    );
  }
}
