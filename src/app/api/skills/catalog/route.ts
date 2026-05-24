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

    // 自建 SKILL 包含 prompt_template（导出需要）与 metadata（编辑时判断来源）
    const custom = await query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages,
              prompt_template, metadata
         FROM user_custom_skills
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [session.user.id]
    );

    return NextResponse.json({ catalog, custom });
  } catch (e) {
    console.error("[skills/catalog] 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 }
    );
  }
}
