import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { SkillsClient } from "@/components/skills/SkillsClient";
import { buildAccessScope } from "@/lib/resourceAccess";
import { hasCapability } from "@/lib/orgAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `SKILL 广场 — 投资分析框架库 | ${BRAND.shortProductName}`,
  description:
    "面向一级股权投资人的AI分析框架库，覆盖BP分析、尽调、行业研究、财务评估等20个核心工作场景，帮助投资人结构化分析决策。",
};

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  applicable_stages: string[] | null;
  requires_capability: string | null;
  prompt_template?: string;
  metadata?: { generated_from_judgments?: boolean } | null;
}

// 当前用户自建 SKILL；metadata 列由迁移 015 引入，未迁移则降级查询。
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
  } catch {
    return query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages, prompt_template
         FROM user_custom_skills
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
  }
}

// SKILL 广场公开页：未登录可浏览全部官方框架（SSR，爬虫可读）；
// 已登录额外加载自建 SKILL 并开放调用/创建/导入等交互。
export default async function SkillsPage({
  searchParams,
}: {
  searchParams?: { scene?: string };
}) {
  const session = await getServerSession(authOptions);
  const isLoggedIn = !!session?.user;

  // 官方 SKILL 始终服务端读取，确保 HTML 含 SKILL 内容
  // requires_capability 列由迁移 033 引入，降级兼容（列不存在时为 null）
  let catalog: SkillRow[] = [];
  try {
    catalog = await query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages, requires_capability
         FROM skill_catalog
        WHERE is_active = true
        ORDER BY sort_order ASC, created_at ASC`
    );
  } catch {
    catalog = await query<SkillRow>(
      `SELECT id, name, description, category, applicable_stages,
              NULL::text AS requires_capability
         FROM skill_catalog
        WHERE is_active = true
        ORDER BY sort_order ASC, created_at ASC`
    );
  }

  // 当前用户是否拥有 zjjr_data 能力位（机构版专属 SKILL 显示逻辑）
  let hasZjjrData = false;
  if (isLoggedIn && session?.user?.id) {
    try {
      const scope = await buildAccessScope(session.user.id);
      if (scope.org) {
        hasZjjrData = await hasCapability(scope.org.orgId, "zjjr_data");
      }
    } catch {
      hasZjjrData = false;
    }
  }

  let custom: SkillRow[] = [];
  if (isLoggedIn) {
    try {
      custom = await loadCustomSkills(session!.user.id);
    } catch {
      custom = [];
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold leading-tight text-ink">
          SKILL 广场
          <span className="mt-1 block text-base font-medium text-ink-soft">
            一级股权投资分析框架库
          </span>
        </h1>
        <p className="mt-2 text-sm text-ink-faint">
          20个专业分析框架，覆盖投资全流程工作场景
        </p>
      </header>

      <SkillsClient
        initialCatalog={catalog}
        initialCustom={custom}
        isLoggedIn={isLoggedIn}
        hasZjjrData={hasZjjrData}
        initialScene={searchParams?.scene ?? null}
      />
    </div>
  );
}
