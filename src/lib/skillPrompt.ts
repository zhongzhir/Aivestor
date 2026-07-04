interface BuildSkillRunPromptOptions {
  promptTemplate: string;
  vars: Record<string, string>;
  prependContext?: string;
  extraInput?: string | null;
}

export function buildSkillRunPrompt({
  promptTemplate,
  vars,
  prependContext,
  extraInput,
}: BuildSkillRunPromptOptions): string {
  let prompt = promptTemplate;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.split(`{${key}}`).join(value);
  }

  const blocks: string[] = [];
  const supplement = extraInput?.trim();
  if (supplement) {
    blocks.push(
      [
        "## 投资人补充说明（必须优先遵循补充说明）",
        supplement,
        "",
        "请将以上补充说明作为本次 SKILL 运行的最高优先级约束：输出范围、关注重点、验证目标和清单条目都必须围绕该说明调整；若与通用 SKILL 模板冲突，以补充说明为准。",
      ].join("\n")
    );
  }

  if (prependContext?.trim()) {
    blocks.push(prependContext.trim());
  }

  blocks.push(prompt);
  return blocks.join("\n\n---\n\n");
}
