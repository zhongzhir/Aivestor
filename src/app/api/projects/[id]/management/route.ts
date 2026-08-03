import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import {
  getProjectManagementOptions,
  projectScope,
  scopeColumns,
  validateProjectLabel,
} from "@/lib/projectManagement";
import {
  accessErrorResponse,
  assertProjectAccess,
  buildAccessScope,
} from "@/lib/resourceAccess";

interface ProjectManagementRow {
  category_id: string | null;
  is_priority: boolean;
  org_id: string | null;
  user_id: string;
}

async function getProject(scope: Awaited<ReturnType<typeof buildAccessScope>>, id: string, action: "read" | "write") {
  const access = await assertProjectAccess(scope, id, action);
  const rows = await query<ProjectManagementRow>(
    `SELECT category_id, is_priority, org_id, user_id
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return { access, project: rows[0] };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await buildAccessScope(session.user.id);
  try {
    const { project } = await getProject(scope, params.id, "read");
    const projectScopeValue = projectScope(scope, { org_id: project.org_id });
    const options = await getProjectManagementOptions(projectScopeValue);
    const tags = await query<{ id: string; name: string }>(
      `SELECT t.id, t.name FROM project_tag_links l
         JOIN project_tags t ON t.id = l.tag_id
        WHERE l.project_id = $1 ORDER BY t.name COLLATE "C"`,
      [params.id]
    );
    return NextResponse.json({
      categoryId: project.category_id,
      isPriority: project.is_priority,
      projectTags: tags,
      ...options,
    });
  } catch (e) {
    return accessErrorResponse(e);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { categoryId?: string | null; isPriority?: boolean; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (body.categoryId !== undefined && body.categoryId !== null && typeof body.categoryId !== "string") {
    return NextResponse.json({ error: "分类值不合法" }, { status: 422 });
  }
  if (body.isPriority !== undefined && typeof body.isPriority !== "boolean") {
    return NextResponse.json({ error: "重点标记值不合法" }, { status: 422 });
  }
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 12)) {
    return NextResponse.json({ error: "标签最多保留 12 个" }, { status: 422 });
  }

  const scope = await buildAccessScope(session.user.id);
  try {
    const { project } = await getProject(scope, params.id, "write");
    const projectScopeValue = projectScope(scope, { org_id: project.org_id });
    const scoped = scopeColumns(projectScopeValue);
    const categoryId = body.categoryId === undefined ? project.category_id : body.categoryId;

    if (body.tags !== undefined) {
      const labels = (body.tags as unknown[]).map((v) => validateProjectLabel(v, "标签"));
      const errors = labels.filter((v): v is { error: string } => "error" in v);
      if (errors[0]) return NextResponse.json({ error: errors[0].error }, { status: 422 });
    }

    await withTransaction(async (client) => {
      if (categoryId) {
        const category = await client.query<{ id: string }>(
          `SELECT id FROM project_categories WHERE id = $1 AND ${scoped.column} = $2`,
          [categoryId, scoped.value]
        );
        if (!category.rows[0]) throw new Error("分类不存在或不属于当前项目范围");
      }

      await client.query(
        `UPDATE projects SET category_id = $1, is_priority = $2, updated_at = NOW()
          WHERE id = $3 AND deleted_at IS NULL`,
        [categoryId, body.isPriority ?? project.is_priority, params.id]
      );

      if (body.tags !== undefined) {
        const labels = (body.tags as unknown[]).map((v) => validateProjectLabel(v, "标签"));
        const unique = new Map<string, { value: string; normalized: string }>();
        for (const label of labels as { value: string; normalized: string }[]) unique.set(label.normalized, label);
        const tagIds: string[] = [];
        for (const tag of unique.values()) {
          const found = await client.query<{ id: string }>(
            `SELECT id FROM project_tags WHERE ${scoped.column} = $1 AND normalized_name = $2`,
            [scoped.value, tag.normalized]
          );
          if (found.rows[0]) {
            tagIds.push(found.rows[0].id);
            continue;
          }
          const created = await client.query<{ id: string }>(
            `INSERT INTO project_tags (${scoped.column}, name, normalized_name)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [scoped.value, tag.value, tag.normalized]
          );
          if (created.rows[0]) {
            tagIds.push(created.rows[0].id);
          } else {
            const concurrent = await client.query<{ id: string }>(
              `SELECT id FROM project_tags WHERE ${scoped.column} = $1 AND normalized_name = $2`,
              [scoped.value, tag.normalized]
            );
            if (!concurrent.rows[0]) throw new Error("标签创建失败");
            tagIds.push(concurrent.rows[0].id);
          }
        }
        await client.query("DELETE FROM project_tag_links WHERE project_id = $1", [params.id]);
        for (const tagId of tagIds) {
          await client.query(
            `INSERT INTO project_tag_links (project_id, tag_id) VALUES ($1, $2)
             ON CONFLICT (project_id, tag_id) DO NOTHING`,
            [params.id, tagId]
          );
        }
        await client.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [params.id]);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "分类不存在或不属于当前项目范围") {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return accessErrorResponse(e);
  }
}
