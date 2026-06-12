import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidStage } from "@/lib/stages";
import {
  buildAccessScope,
  assertProjectAccess,
  accessErrorResponse,
  type AccessScope,
} from "@/lib/resourceAccess";

interface JudgmentRow {
  id: string;
  stage: string;
  bull_case: string | null;
  bear_case: string | null;
  founder_assessment: string | null;
  key_hypothesis: string | null;
  confidence_level: number | null;
  created_at: string;
}

// GET /api/projects/[id]/judgments — 当前用户在该项目下的判断记录，按时间倒序。
// 注意：永远只返回本人判断；组织项目下他人判断仅经聚合接口（4.3）出。
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const scope: AccessScope = await buildAccessScope(session.user.id);
    try {
      await assertProjectAccess(scope, params.id, "read");
    } catch (e) {
      return accessErrorResponse(e);
    }

    const rows = await query<JudgmentRow>(
      `SELECT id, stage, bull_case, bear_case, founder_assessment,
              key_hypothesis, confidence_level, created_at
         FROM investment_judgments
        WHERE project_id = $1 AND user_id = $2
        ORDER BY created_at DESC`,
      [params.id, session.user.id]
    );

    return NextResponse.json({ judgments: rows });
  } catch (e) {
    console.error("[judgments] GET 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "判断记录读取失败" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/judgments — 新增一条判断记录
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const scope: AccessScope = await buildAccessScope(session.user.id);
    let projectOrgId: string | null = null;
    try {
      const info = await assertProjectAccess(scope, params.id, "write");
      projectOrgId = info.orgId;
    } catch (e) {
      return accessErrorResponse(e);
    }

    let body: {
      stage?: string;
      bull_case?: string;
      bear_case?: string;
      founder_assessment?: string;
      key_hypothesis?: string;
      confidence_level?: number;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    if (!isValidStage(body.stage)) {
      return NextResponse.json({ error: "阶段值不合法" }, { status: 422 });
    }

    let confidence: number | null = null;
    if (body.confidence_level != null) {
      const c = Number(body.confidence_level);
      if (!Number.isInteger(c) || c < 1 || c > 5) {
        return NextResponse.json(
          { error: "信心评分须为 1-5" },
          { status: 422 }
        );
      }
      confidence = c;
    }

    const norm = (v?: string) => {
      const t = v?.trim();
      return t ? t : null;
    };
    const bull = norm(body.bull_case);
    const bear = norm(body.bear_case);
    const founder = norm(body.founder_assessment);
    const hypothesis = norm(body.key_hypothesis);

    // content 在原始 schema 中为 NOT NULL；即使迁移 004 已放宽，
    // 这里仍主动写入合成正文，确保 INSERT 不依赖迁移是否应用。
    const content =
      [
        bull && `看好的理由：${bull}`,
        bear && `主要顾虑：${bear}`,
        founder && `对创始人的判断：${founder}`,
        hypothesis && `关键待验证假设：${hypothesis}`,
      ]
        .filter(Boolean)
        .join("\n") || "（未填写具体内容）";

    const rows = await query<JudgmentRow>(
      `INSERT INTO investment_judgments
         (user_id, project_id, stage, content, bull_case, bear_case,
          founder_assessment, key_hypothesis, confidence_level, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, stage, bull_case, bear_case, founder_assessment,
                 key_hypothesis, confidence_level, created_at`,
      [
        session.user.id,
        params.id,
        body.stage,
        content,
        bull,
        bear,
        founder,
        hypothesis,
        confidence,
        projectOrgId,
      ]
    );

    return NextResponse.json({ judgment: rows[0] }, { status: 201 });
  } catch (e) {
    console.error("[judgments] POST 失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "判断记录保存失败" },
      { status: 500 }
    );
  }
}
