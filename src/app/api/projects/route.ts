import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { ALL_STAGES } from "@/lib/stages";

const ALLOWED_OUTCOMES = new Set([
  "pending",
  "invested",
  "passed",
  "exited_profit",
  "exited_loss",
]);

// GET /api/projects — 列出当前用户的项目，支持 search / stage / process_stage / outcome / sort
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const search = (sp.get("search") ?? "").trim();
  const stage = (sp.get("stage") ?? "").trim();
  const processStageRaw = (sp.get("process_stage") ?? "").trim();
  const outcomeRaw = (sp.get("outcome") ?? "").trim();
  const sort = (sp.get("sort") ?? "created_desc").trim();

  const processStage = (ALL_STAGES as readonly string[]).includes(processStageRaw)
    ? processStageRaw
    : "";
  const outcome = ALLOWED_OUTCOMES.has(outcomeRaw) ? outcomeRaw : "";

  const where: string[] = ["p.user_id = $1"];
  const params: unknown[] = [session.user.id];

  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR p.judgment_points::text ILIKE $${params.length})`
    );
  }
  if (stage) {
    params.push(stage);
    where.push(`p.stage = $${params.length}`);
  }
  if (processStage) {
    params.push(processStage);
    where.push(`p.process_stage = $${params.length}`);
  }
  if (outcome) {
    params.push(outcome);
    where.push(`p.outcome = $${params.length}`);
  }

  const orderBy =
    sort === "updated_desc" ? "p.updated_at DESC" : "p.created_at DESC";

  const rows = await query(
    `SELECT p.id, p.name, p.company_name, p.industry, p.stage, p.status,
            p.created_at, p.updated_at,
            r.id   AS latest_report_id,
            r.status AS latest_report_status,
            (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS file_count,
            (SELECT COUNT(*)::int FROM reports rr WHERE rr.project_id = p.id) AS report_count
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT id, status FROM reports
          WHERE project_id = p.id
          ORDER BY updated_at DESC LIMIT 1
       ) r ON true
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}`,
    params
  );

  return NextResponse.json({ projects: rows });
}

// POST /api/projects — 创建项目
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    name?: string;
    companyName?: string;
    industry?: string;
    stage?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "请填写项目名称" }, { status: 400 });
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO projects (user_id, name, company_name, industry, stage)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      session.user.id,
      name,
      body.companyName?.trim() || null,
      body.industry?.trim() || null,
      body.stage?.trim() || null,
    ]
  );

  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
