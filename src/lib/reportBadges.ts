// 把报告 Markdown 中的溯源标记替换为可被
// react-markdown + rehype-raw 渲染的内联 HTML 徽章。
//
// 仅用于报告渲染层；导出 Word/PPT 时需先用 stripSourceBadges 剥离。

const BADGES = [
  {
    re: /\[src:doc\]/g,
    html: ' <span class="src-badge src-doc">📄 文件依据</span>',
  },
  {
    re: /\[src:data\]/g,
    html: ' <span class="src-badge src-data">✅ 数据提取</span>',
  },
  {
    re: /\[src:ai\]/g,
    html: ' <span class="src-badge src-ai">🤖 AI 推断</span>',
  },
  {
    re: /\[src:external\]/g,
    html: ' <span class="src-badge src-external">🔗 外部证据</span>',
  },
  {
    re: /\[src:gap\]/g,
    html: ' <span class="src-badge src-gap">待补</span>',
  },
  {
    re: /\[src:inconsistent\]/g,
    html: ' <span class="src-badge src-inconsistent">冲突</span>',
  },
];

export function renderSourceBadges(markdown: string): string {
  if (!markdown) return markdown;
  let out = markdown;
  for (const b of BADGES) out = out.replace(b.re, b.html);
  return out;
}

// 用于导出（Word / PPT / 纯文本）：剥离所有溯源标记。
export function stripSourceBadges(markdown: string): string {
  if (!markdown) return markdown;
  return markdown.replace(
    /\[src:(doc|data|ai|external|gap|inconsistent)\]/g,
    ""
  );
}
