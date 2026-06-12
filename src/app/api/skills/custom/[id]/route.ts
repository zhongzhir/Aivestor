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

function normalizeStages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (s): s is string =>
      typeof s === "string" && (SKILL_STAGES as readonly string[]).includes(s)
  );
}

// 写权限校验：本人 SKILL（user_id 命中）或组织共享 SKILL 且本人 partner+。
// 返回 true 表示可写。个人版（无 org）只可能命中 user_id 分支，与现状等价。
async function canWriteSkill(
  skillId: string,
  userId: string
): Promise<boolean> {
  const rows = await query<{ user_id: string; org_id: string | null }>(
    "SELECT user_id, org_id FROM user_custom_skills WHERE id = $1",
    [skillId]
  );
  const skill = rows[0];
  if (!skill) return false;
  if (skill.user_id === userId) return true;
  if (!skill.org_id) return false;
  const scope = await buildAccessScope(userId);
  return (
    !!scope.org &&
    scope.org.orgId === skill.org_id &&
    (scope.org.role === "admin" || scope.org.role === "partner")
  );
}

// PUT /api/skills/custom/[id] — 更新自建 SKILL
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
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

    if (!(await canWriteSkill(params.id, session.user.id))) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }

    const rows = await query<CustomSkillRow>(
      `UPDATE user_custom_skills
          SET name = $1, description = $2, category = $3,
              prompt_template = $4, applicable_stages = $5, updated_at = NOW()
        WHERE id = $6
        RETURNING id, name, description, category, prompt_template,
                  applicable_stages, org_id, created_at, updated_at`,
      [
        name,
        body.description?.trim() || null,
        category,
        promptTemplate,
        normalizeStages(body.applicable_stages),
        params.id,
      ]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }
    return NextResponse.json({ skill: rows[0] });
  } catch (e) {
    console.error("[skills/custom/:id] PUT 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 }
    );
  }
}

// DELETE /api/skills/custom/[id] — 删除自建 SKILL
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!(await canWriteSkill(params.id, session.user.id))) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }
    const rows = await query<{ id: string }>(
      "DELETE FROM user_custom_skills WHERE id = $1 RETURNING id",
      [params.id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "SKILL 不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[skills/custom/:id] DELETE 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 }
    );
  }
}
