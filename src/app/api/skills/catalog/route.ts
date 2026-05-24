import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[];
  prompt_template?: string;
  metadata?: Record<string, unknown>;
}

// 加载当前用户的自建 SKILL。
// metadata 列由迁移 015 引入；若目标库尚未迁移，则降级为不取 metadata，
// 保证自建 SKILL 仍能正常显示（仅「由历史判断生成」提示暂不可用）。
async function loadCustomSkills(userId: string): Promise<SkillRow[]> {
  try {
    return await query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages,
              prompt_template, metadata
         FROM user_custom_skills
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
  } catch (e) {
    console.error("[skills/catalog] 取 metadata 失败，降级重试:", e);
    return query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages, prompt_template
         FROM user_custom_skills
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
  }
}

// GET /api/skills/catalog — 官方 SKILL（is_active）+ 当前用户自建 SKILL
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const catalog = await query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages
         FROM skill_catalog
        WHERE is_active = true
        ORDER BY sort_order ASC, created_at ASC`
    );

    // 自建 SKILL 单独容错：即便自建查询失败（如 metadata 列尚未迁移），
    // 也不能连累官方 SKILL 一起返回空 —— 官方列表必须始终可见。
    const custom = await loadCustomSkills(session.user.id);

    return NextResponse.json({ catalog, custom });
  } catch (e) {
    console.error("[skills/catalog] 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 }
    );
  }
}
