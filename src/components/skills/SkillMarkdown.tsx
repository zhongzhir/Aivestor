"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

/**
 * Skill 专用 Markdown 展示。
 * 与正式报告保持独立，避免 Skill 的流式分析结果被报告正文样式牵连。
 */
export function SkillMarkdown({ content }: Props) {
  return (
    <div className="skill-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
