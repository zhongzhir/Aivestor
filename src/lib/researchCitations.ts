interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

/** Support models that return plain [1] as well as the requested Markdown link. */
export function remarkResearchCitations({ sourceCount }: { sourceCount: number }) {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children || ["link", "linkReference", "code", "inlineCode", "html"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const value = child.value;
        const parts: MarkdownNode[] = [];
        let start = 0;
        for (const match of value.matchAll(/\[(\d+)\]/g)) {
          const number = Number(match[1]);
          if (number < 1 || number > sourceCount) continue;
          const offset = match.index!;
          if (offset > start) parts.push({ type: "text", value: value.slice(start, offset) });
          parts.push({ type: "link", url: `#source-${number}`, children: [{ type: "text", value: match[0] }] });
          start = offset + match[0].length;
        }
        if (!parts.length) return [child];
        if (start < value.length) parts.push({ type: "text", value: value.slice(start) });
        return parts;
      });
    }
    visit(tree);
  };
}

/** Keep original source indices: existing answers must never be renumbered. */
export function researchCitationIndices(content: string, sourceCount: number): number[] {
  const indices = new Set<number>();
  const add = (number: number) => {
    if (number >= 1 && number <= sourceCount) indices.add(number - 1);
  };
  const prose = content
    .replace(/(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*(?=\n|$)|$)/g, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/!?\[[^\]\n]*\]\(([^\s)]*)[^)]*\)/g, (link, href: string) => {
      const reference = href.match(/^#source-(\d+)$/);
      if (!link.startsWith("!") && reference) add(Number(reference[1]));
      return " ";
    })
    .replace(/\\\[\d+\]|<[^>]*>/g, " ");
  for (const match of prose.matchAll(/\[(\d+)\]/g)) add(Number(match[1]));
  return [...indices].sort((a, b) => a - b);
}
