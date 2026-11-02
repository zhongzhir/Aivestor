export function partitionAttentionProjects<T>(projects: T[]) {
  return {
    total: projects.length,
    primary: projects.slice(0, 3),
    remaining: projects.slice(3),
  };
}
