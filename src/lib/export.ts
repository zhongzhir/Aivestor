// 数据导出与迁移：三种导出格式（System Prompt / 知识库快照 / 完整档案）共用的
// 常量与格式化工具。所有导出产物末尾统一附上品牌署名行。

// 文件 / prompt 末尾统一署名行
export const EXPORT_FOOTER =
  "本档案由 Aivestor 生成 · aivestor.cn · 你的判断，永远属于你";

// 知识库条目（导出场景需要的字段子集）
export interface ExportKnowledgeEntry {
  entry_type: string | null;
  source_type: string | null;
  title: string | null;
  content: string;
  tags: string[] | null;
  created_at: string;
}

// 分组键的展示标签。手动录入（source_type=manual）单列一组，
// 其余按 entry_type 归组，避免把用户手写笔记和原始文档切片混在一起。
const GROUP_LABEL: Record<string, string> = {
  thesis: "投资逻辑",
  industry: "行业认知",
  prediction: "预测与复盘",
  manual: "手动笔记",
  conversation_digest: "对话沉淀",
  project: "项目库",
  chunk: "文档切片",
  document_chunk: "文档切片",
};

// 分组展示顺序：用户主动沉淀的认知在前，原始切片在后。
const GROUP_ORDER = [
  "thesis",
  "industry",
  "prediction",
  "manual",
  "conversation_digest",
  "project",
  "chunk",
  "document_chunk",
];

function groupKey(e: ExportKnowledgeEntry): string {
  if (e.source_type === "manual") return "manual";
  return e.entry_type || "chunk";
}

// 形如 2026-05-25 的日期串（用于文件名与正文）。
export function exportDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 把 created_at 字符串安全转为 YYYY-MM-DD；无法解析则返回空串。
function entryDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : exportDateStr(d);
}

// 把知识库条目按分组渲染为 Markdown 正文（不含顶层标题与署名）。
export function formatKnowledgeMarkdown(
  entries: ExportKnowledgeEntry[]
): string {
  const groups = new Map<string, ExportKnowledgeEntry[]>();
  for (const e of entries) {
    const k = groupKey(e);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }

  const orderedKeys = [
    ...GROUP_ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !GROUP_ORDER.includes(k)),
  ];

  const lines: string[] = [];
  for (const key of orderedKeys) {
    const items = groups.get(key)!;
    lines.push(`## ${GROUP_LABEL[key] ?? key}（${items.length}）`, "");
    items.forEach((e, i) => {
      const heading = e.title?.trim() || `条目 ${i + 1}`;
      lines.push(`### ${heading}`);
      const meta: string[] = [];
      const date = entryDate(e.created_at);
      if (date) meta.push(date);
      if (e.tags?.length) meta.push(e.tags.join(" / "));
      if (meta.length) lines.push(`*${meta.join(" · ")}*`);
      lines.push("", e.content.trim(), "");
    });
  }
  return lines.join("\n").trim();
}

// 组装完整的知识库快照 Markdown 文档（含标题、生成日期与署名）。
export function buildKnowledgeSnapshot(
  entries: ExportKnowledgeEntry[]
): string {
  const date = exportDateStr();
  const body =
    entries.length > 0
      ? formatKnowledgeMarkdown(entries)
      : "_知识库暂无条目。_";
  return [
    "# 我的知识库快照",
    "",
    `*导出日期：${date} · 共 ${entries.length} 条*`,
    "",
    body,
    "",
    "---",
    "",
    EXPORT_FOOTER,
    "",
  ].join("\n");
}
