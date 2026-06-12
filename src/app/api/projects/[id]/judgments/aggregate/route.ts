import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
} from "@/lib/resourceAccess";

// 多人判断聚合（架构文档 4.3）。partner/admin 可调；analyst 403——
// 对应 1.2 矩阵「看他人判断」仅 partner+。

interface AggRow {
  user_id: string;
  user_name: string | null;
  role: string;
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

interface MemberJudgments {
  userId: string;
  userName: string;
  role: string;
  judgments: Array<{
    stage: string;
    bull_case: string | null;
    bear_case: string | null;
    founder_assessment: string | null;
    key_hypothesis: string | null;
    confidence_level: number | null;
    created_at: string;
  }>;
}

// GET /api/projects/[id]/judgments/aggregate — 按成员分组的判断聚合
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const scope = await buildAccessScope(session.user.id);
  try {
    await assertProjectAccess(scope, params.id, "read");
  } catch (e) {
    return accessErrorResponse(e);
  }

  // 仅组织项目 + partner/admin 可见他人判断
  if (
    !scope.org ||
    (scope.org.role !== "admin" && scope.org.role !== "partner")
  ) {
    return NextResponse.json(
      { error: "仅 partner 及以上可查看多人判断聚合" },
      { status: 403 }
    );
  }

  const rows = await query<AggRow>(
    `SELECT j.user_id, u.name AS user_name, m.role,
            j.stage, j.bull_case, j.bear_case, j.founder_assessment,
            j.key_hypothesis, j.confidence_level, j.created_at
       FROM investment_judgments j
       LEFT JOIN users u ON u.id = j.user_id
       LEFT JOIN org_members m ON m.user_id = j.user_id AND m.org_id = $2
      WHERE j.project_id = $1 AND j.org_id = $2
      ORDER BY j.user_id, j.created_at DESC`,
    [params.id, scope.org.orgId]
  );

  const byUser = new Map<string, MemberJudgments>();
  for (const r of rows) {
    const entry =
      byUser.get(r.user_id) ??
      ({
        userId: r.user_id,
        userName: r.user_name?.trim() || "组织成员",
        role: r.role ?? "analyst",
        judgments: [],
      } as MemberJudgments);
    entry.judgments.push({
      stage: r.stage,
      bull_case: r.bull_case,
      bear_case: r.bear_case,
      founder_assessment: r.founder_assessment,
      key_hypothesis: r.key_hypothesis,
      confidence_level: r.confidence_level,
      created_at: r.created_at,
    });
    byUser.set(r.user_id, entry);
  }

  return NextResponse.json({ members: Array.from(byUser.values()) });
}
