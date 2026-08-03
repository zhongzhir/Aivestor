import { query } from "@/lib/db";
import type { AccessScope } from "@/lib/resourceAccess";

export interface ProjectCategory {
  id: string;
  name: string;
}

export interface ProjectTag {
  id: string;
  name: string;
}

export interface ProjectManagementOptions {
  categories: ProjectCategory[];
  tags: ProjectTag[];
}

export function normalizeProjectLabel(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function validateProjectLabel(
  value: unknown,
  kind: "分类" | "标签"
): { value: string; normalized: string } | { error: string } {
  if (typeof value !== "string") return { error: `${kind}名称格式不正确` };
  const text = value.trim();
  if (!text) return { error: `请输入${kind}名称` };
  const max = kind === "分类" ? 40 : 24;
  if (text.length > max) return { error: `${kind}名称不能超过 ${max} 个字符` };
  const normalized = normalizeProjectLabel(text);
  if (!normalized) return { error: `请输入${kind}名称` };
  return { value: text, normalized };
}

export function scopeColumns(scope: AccessScope): {
  column: "user_id" | "org_id";
  value: string;
} {
  return scope.org
    ? { column: "org_id", value: scope.org.orgId }
    : { column: "user_id", value: scope.userId };
}

export function projectScope(scope: AccessScope, project: { org_id?: string | null; orgId?: string | null }): AccessScope {
  return (project.org_id ?? project.orgId) ? scope : { ...scope, org: null };
}

export async function getProjectManagementOptions(
  scope: AccessScope
): Promise<ProjectManagementOptions> {
  const scopes = scope.org
    ? [{ column: "org_id", value: scope.org.orgId }, { column: "user_id", value: scope.userId }]
    : [scopeColumns(scope)];
  const [categories, tags] = await Promise.all([
    query<ProjectCategory>(
      `SELECT id, name FROM project_categories
        WHERE (${scopes.map((_, index) => `${scopes[index].column} = $${index + 1}`).join(" OR ")})
        ORDER BY name COLLATE "C"`,
      scopes.map((item) => item.value)
    ),
    query<ProjectTag>(
      `SELECT id, name FROM project_tags
        WHERE (${scopes.map((_, index) => `${scopes[index].column} = $${index + 1}`).join(" OR ")})
        ORDER BY name COLLATE "C"`,
      scopes.map((item) => item.value)
    ),
  ]);
  return { categories, tags };
}
